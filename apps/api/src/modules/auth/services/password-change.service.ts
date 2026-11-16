import { Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { NotFoundError, UnauthorizedError, ValidationError } from '../../../common/errors';
import {
  TWO_FACTOR_MANAGE_RATE_LIMIT,
  TWO_FACTOR_MANAGE_RATE_WINDOW_SECONDS,
} from '../auth.constants';
import { PasswordService } from './password.service';
import { TokenService, TokenType } from './token.service';
import { AuthSharedService } from './auth-shared.service';
import { TrustedDeviceService } from './trusted-device.service';
import { EmailChangeService } from './email-change.service';
import { UserService } from '../../user/user.service';
import { MailService } from '../../mail/mail.service';
import { SessionRevocationService } from '../../events/session-revocation.service';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../../common/database/prisma.service';

@Injectable()
export class PasswordChangeService {
  private readonly logger = new Logger(PasswordChangeService.name);

  constructor(
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly userService: UserService,
    private readonly mailService: MailService,
    private readonly sessionRevocation: SessionRevocationService,
    private readonly auditService: AuditService,
    private readonly prismaService: PrismaService,
    private readonly shared: AuthSharedService,
    private readonly trustedDeviceService: TrustedDeviceService,
    private readonly emailChangeService: EmailChangeService,
  ) {}

  /**
   * Change password for authenticated user.
   * Invalidates all other sessions and re-creates the caller's session.
   *
   * Budgeted per-user before anything else, like every other authenticated
   * password oracle (sudo confirm, 2FA manage, email change): this procedure
   * verifies the current password, so an attacker holding a hijacked session
   * could otherwise guess at Argon2 speed with no ceiling, and a hit rotates
   * the password, which revokes every other session and trusted device and
   * locks the legitimate owner out. Per-user, not per-IP: a hijacked session
   * can rotate addresses. Lockout counters are deliberately NOT fed, matching
   * sudo: this endpoint is authenticated and self-scoped, so feeding them would
   * turn a typo into a self-DoS.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    ip: string,
    userAgent: string,
    req: Request,
    res: Response,
  ): Promise<void> {
    await this.shared.enforceRateLimit(
      `password-change:${userId}`,
      TWO_FACTOR_MANAGE_RATE_LIMIT,
      TWO_FACTOR_MANAGE_RATE_WINDOW_SECONDS,
    );

    // The credential finder carries passwordHash, which the verify step below
    // needs; the default findById omits it.
    const user = await this.userService.findCredentialById(userId);
    if (!user) {
      throw new NotFoundError();
    }

    // An OAuth-only account has no current password to change. Fail closed with
    // a dedicated appCode that points at password reset (which doubles as
    // set-password for these users) instead of the misleading "current password
    // is incorrect". Safe to be specific here, unlike at login: this procedure
    // is authenticated and self-scoped, so it only tells callers how their OWN
    // account signs in. BAD_REQUEST rather than UNAUTHORIZED so the client does
    // not mistake it for an expired session and log the user out.
    if (user.passwordHash === null) {
      throw new ValidationError(
        AppErrorCode.PASSWORD_NOT_SET,
        'No password is set on this account. Use password reset to set one.',
      );
    }

    // Verify current password. The distinct INVALID_CREDENTIALS appCode lets
    // the settings form attach the error to the current-password field instead
    // of confusing it with a session-expiry UNAUTHORIZED.
    const passwordValid = await this.passwordService.verify(user.passwordHash, currentPassword);
    if (!passwordValid) {
      throw new UnauthorizedError(
        AppErrorCode.INVALID_CREDENTIALS,
        'Current password is incorrect',
      );
    }

    const passwordHash = await this.passwordService.hash(newPassword);

    // The password write and the reset-token revoke run in ONE transaction
    // (mirroring password-reset): a reset flow started before this change
    // could otherwise still be completed and take over the account if a crash
    // landed the new password but left the PASSWORD_RESET token alive.
    await this.prismaService.client.$transaction(async (tx) => {
      await this.userService.updatePassword(userId, passwordHash, tx);
      await this.tokenService.invalidateUserTokens(userId, TokenType.PASSWORD_RESET, tx);
    });

    // Revoke every session (invalidates every device) and drop live sockets
    // in one step. The caller's own socket reconnects with the fresh session
    // created below.
    await this.sessionRevocation.revokeAllAndDisconnect(userId);
    // A compromised-password episode should not leave pre-authorized browsers
    // behind, so trusted devices are forgotten on a password change too.
    await this.trustedDeviceService.revokeAll(userId);
    // A pending email change dies with the credential rotation: the tripwire
    // tells a victim to change the password, and doing so must strand any
    // attacker-held confirmation link (see EmailChangeService).
    await this.emailChangeService.invalidatePending(userId);

    // Re-create a session for the current caller so they stay logged in (one
    // shared create-session + cookie + CSRF-rotation path). Carry the tenant
    // forward so the rotated session stays tenant-scoped.
    //
    // Deliberately passes NO epoch, so createSession reads the counter this
    // flow just bumped. Capturing one at the top of the request would stamp the
    // pre-revocation value and this replacement session would fence itself out
    // the moment it was written.
    await this.shared.establishSession(req, res, {
      userId: user.id,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerified,
      ip,
      userAgent,
      rememberMe: false,
      tenantId: user.tenantId,
    });

    await this.auditService.log({
      action: AUDIT_ACTIONS.AUTH_PASSWORD_CHANGE,
      userId,
      targetType: 'User',
      targetId: userId,
      ipAddress: ip,
      userAgent,
    });

    // Send password changed notification
    try {
      await this.mailService.sendPasswordChangedEmail(user.email);
    } catch (error) {
      this.logger.error('Failed to send password changed email', error);
    }
  }
}
