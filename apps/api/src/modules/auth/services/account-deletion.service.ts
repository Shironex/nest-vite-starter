import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { NotFoundError, UnauthorizedError, ValidationError } from '../../../common/errors';
import { CsrfService } from '../../../common/security/csrf.service';
import { PasswordService } from './password.service';
import { AuthSharedService } from './auth-shared.service';
import { UserService } from '../../user/user.service';
import { AuditService } from '../../audit/audit.service';

/**
 * Fixed window for delete-account attempts, per user. The endpoint verifies
 * the current password, so without a limit it doubles as a password oracle
 * for a hijacked-but-unauthenticated-elsewhere session (tRPC procedures sit
 * outside the global ThrottlerGuard). Mirrors the resend-verification
 * per-user window in email-verification.service.ts.
 */
const DELETE_ACCOUNT_RATE_LIMIT = 5;
const DELETE_ACCOUNT_RATE_WINDOW_SECONDS = 15 * 60;

@Injectable()
export class AccountDeletionService {
  constructor(
    private readonly passwordService: PasswordService,
    private readonly userService: UserService,
    private readonly auditService: AuditService,
    private readonly csrfService: CsrfService,
    private readonly shared: AuthSharedService,
  ) {}

  /**
   * Self-service account deletion, confirmed with the current password.
   *
   * Soft-deletes the row (every notDeleted-guarded read and write excludes it
   * from now on, so the user cannot log in, reset their password, or verify
   * their email), then tears the session state down. The user-purge cron
   * hard-deletes the row after USER_PURGE_GRACE_DAYS.
   *
   * Order: verify password -> soft delete -> audit (while the request context
   * still carries the actor) -> revoke sessions ->
   * clear the session cookie + rotate CSRF. The caller is logged out by
   * construction: their session is gone and the cookie is cleared.
   */
  async deleteAccount(
    userId: string,
    password: string,
    ip: string,
    userAgent: string,
    req: Request,
    res: Response,
  ): Promise<void> {
    await this.shared.enforceRateLimit(
      `delete-account:${userId}`,
      DELETE_ACCOUNT_RATE_LIMIT,
      DELETE_ACCOUNT_RATE_WINDOW_SECONDS,
    );

    // The credential finder carries passwordHash, which the verify step below
    // needs; the default findById omits it (mirrors password-change).
    const user = await this.userService.findCredentialById(userId);
    if (!user) {
      throw new NotFoundError();
    }

    // An account with no password has nothing to confirm with, so this
    // destructive action cannot be authorized here. Fail CLOSED (never treat a
    // missing hash as "confirmed") with the dedicated appCode pointing at
    // password reset, which doubles as set-password. Authenticated and
    // self-scoped, so being specific reveals nothing about anyone else's
    // account (mirrors password-change).
    if (user.passwordHash === null) {
      throw new ValidationError(
        AppErrorCode.PASSWORD_NOT_SET,
        'No password is set on this account. Use password reset to set one before deleting.',
      );
    }

    // The distinct INVALID_CREDENTIALS appCode lets the settings form attach
    // the error to the password field instead of confusing it with a
    // session-expiry UNAUTHORIZED (mirrors password-change).
    const passwordValid = await this.passwordService.verify(user.passwordHash, password);
    if (!passwordValid) {
      throw new UnauthorizedError(AppErrorCode.INVALID_CREDENTIALS, 'Password is incorrect');
    }

    // Checked AFTER the password, so an unauthenticated guess cannot learn the
    // shape of somebody else's organization, and in the SAME transaction as the write
    // under the per-tenant membership lock: two admins deleting themselves in
    // the same second would otherwise both read two live admins and both
    // commit, leaving the organization with none, which is the state this guard exists
    // to prevent and which has no in-app remedy.
    //
    // Zero rows means a concurrent request soft-deleted the row between the
    // credential read and this write. Idempotent: the outcome the caller asked
    // for holds, so continue with the teardown instead of erroring.
    await this.userService.softDeleteSelfKeepingOneAdmin(user);

    // Audit BEFORE the teardown: the write itself never throws, and logging
    // here keeps the trail complete even if the revocation below fails.
    await this.auditService.log({
      action: AUDIT_ACTIONS.USER_ACCOUNT_DELETED,
      userId,
      targetType: 'User',
      targetId: userId,
      ipAddress: ip,
      userAgent,
    });

    // Sessions in the one shared teardown
    // (DB write first, same order contract as updateRole).
    await this.userService.revokeAuthState(userId);

    // Clear the caller's cookie and rotate CSRF, mirroring logout: the auth
    // state changed, so a token tied to the pre-deletion sid must not survive.
    this.shared.clearSessionCookie(res);
    this.csrfService.rotate(req, res);
  }
}
