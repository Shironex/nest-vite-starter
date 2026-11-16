import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type Redis from 'ioredis';
import { z } from 'zod';
import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { EMAIL_CHANGE_TOKEN_TTL_MS } from '@repo/shared/constants';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../../../common/errors';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { RedisKeys } from '../../../common/redis/redis-keys';
import { sha256Hex } from '../../../common/utils/crypto';
import { TokenService, TokenType } from './token.service';
import { AuthSharedService } from './auth-shared.service';
import { StepUpService } from './step-up.service';
import { UserService } from '../../user/user.service';
import { MailService } from '../../mail/mail.service';
import { AuditService } from '../../audit/audit.service';
import { SessionRevocationService } from '../../events/session-revocation.service';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  isPrismaUniqueConstraintError,
  uniqueConstraintTargetText,
} from '../prisma-unique-error.util';
import { TOKEN_ENTROPY_BYTES } from '../auth.constants';
import {} from '../two-factor.util';

/**
 * Fixed window for email-change requests, matching the resend-verification
 * knob (3 / hour): each request enqueues two emails, so the envelope is a
 * mail-bombing bound as much as a brute-force one.
 */
const REQUEST_WINDOW_SECONDS = 60 * 60;
const MAX_REQUESTS_PER_WINDOW = 3;

const EMAIL_CHANGE_TOKEN_TTL_SECONDS = EMAIL_CHANGE_TOKEN_TTL_MS / 1000;

/**
 * Runtime shape of the Redis-persisted pending change. Parsed (never cast) on
 * consume, mirroring the OAuth flow-state discipline: Redis is a process
 * boundary, and a corrupt blob must read as "no pending change", not throw.
 */
const pendingEmailChangeSchema = z.object({
  userId: z.string().min(1),
  newEmail: z.string().min(1),
});

/**
 * The verified email-change flow. The security shape, in order:
 *
 *   1. `requestEmailChange` runs behind AuthMiddleware plus the sudo flag
 *      minted by `auth.confirmPassword` (checked in the router, mirroring
 *      `oauth.unlink`), and demands a current TOTP/recovery code when the
 *      account has an active second factor, so a stolen session cookie alone
 *      can neither start nor complete a change.
 *   2. The NEW address must prove itself by consuming a single-use link
 *      before it becomes the login identity; until then the old address
 *      stays authoritative everywhere.
 *   3. The OLD address gets a tripwire the moment a change is requested:
 *      the one mailbox guaranteed to still belong to the legitimate owner,
 *      with the whole confirmation window to react.
 *   4. A password change or reset invalidates the pending change (see
 *      `invalidatePending`): rotating the credential must strand any
 *      attacker-held confirmation link.
 *
 * The pending change lives in Redis (keyed by sha256(token), one live record
 * per user), NOT in the DB Token table: the token row there has no column for
 * the new address, so the DB pattern would need a schema change for strictly
 * less capability than the 2FA pending-challenge pattern this mirrors.
 */
@Injectable()
export class EmailChangeService {
  private readonly logger = new Logger(EmailChangeService.name);

  constructor(
    private readonly userService: UserService,
    private readonly mailService: MailService,
    private readonly auditService: AuditService,
    private readonly sessionRevocation: SessionRevocationService,
    private readonly prismaService: PrismaService,
    private readonly tokenService: TokenService,
    private readonly stepUpService: StepUpService,
    private readonly shared: AuthSharedService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Start an email change for an authenticated, sudo-confirmed user: validate
   * the new address, demand a second factor where one is active, store the
   * pending change, mail the confirmation link to the NEW address and the
   * tripwire to the OLD one.
   */
  async requestEmailChange(
    userId: string,
    newEmail: string,
    factorCode: string | undefined,
    ip: string,
    userAgent: string,
  ): Promise<void> {
    await this.shared.enforceRateLimit(
      `email-change:${userId}`,
      MAX_REQUESTS_PER_WINDOW,
      REQUEST_WINDOW_SECONDS,
    );

    const user = await this.userService.findById(userId);
    if (!user) {
      throw new UnauthorizedError(AppErrorCode.UNAUTHORIZED, 'Session is no longer valid');
    }

    // The zod schema already trims + lowercases; normalizing again here keeps
    // the invariant local instead of trusting every future caller.
    const normalizedEmail = this.userService.normalizeEmail(newEmail);

    // "Already your address" maps to the same code as "someone else's
    // address": EMAIL_IN_USE is literally true and adds no oracle.
    if (normalizedEmail === user.email) {
      throw new ValidationError(AppErrorCode.EMAIL_IN_USE, AppErrorCode.EMAIL_IN_USE);
    }
    if (await this.userService.isDisposableEmail(normalizedEmail)) {
      throw new ForbiddenError(AppErrorCode.DISPOSABLE_EMAIL);
    }
    // Best-effort pre-check (parity with register): the authoritative
    // uniqueness gate is the DB constraint at confirm time.
    if (await this.userService.findByEmail(normalizedEmail)) {
      throw new ValidationError(AppErrorCode.EMAIL_IN_USE, AppErrorCode.EMAIL_IN_USE);
    }

    // 2FA gate: when the account has an active non-recovery factor, password
    // sudo alone must not be enough to move the login identity (mirrors the
    // password-reset gate, sharing its rate limit and audit reason).
    await this.stepUpService.assertSecondFactor({
      userId,
      code: factorCode,
      ip,
      context: 'email_change',
    });

    const rawToken = randomBytes(TOKEN_ENTROPY_BYTES).toString('hex');
    const tokenHash = sha256Hex(rawToken);

    // Replace-then-create, the Redis mirror of TokenService's transactional
    // delete-then-create: at most one live pending change per user, so an
    // abandoned earlier request cannot be confirmed after this one.
    const previousHash = await this.redis.getdel(RedisKeys.emailChangeUser(userId));
    if (previousHash) {
      await this.redis.del(RedisKeys.emailChange(previousHash));
    }
    await this.redis
      .multi()
      .setex(
        RedisKeys.emailChange(tokenHash),
        EMAIL_CHANGE_TOKEN_TTL_SECONDS,
        JSON.stringify({ userId, newEmail: normalizedEmail }),
      )
      .setex(RedisKeys.emailChangeUser(userId), EMAIL_CHANGE_TOKEN_TTL_SECONDS, tokenHash)
      .exec();

    // The confirmation link is the flow's critical mail: a failed ENQUEUE
    // (delivery is async, retried, DLQ-backed) propagates so the caller sees
    // the request fail instead of waiting for mail that never comes. The
    // pending record left behind is inert: its raw token existed only here.
    const confirmUrl = `${this.shared.appUrl}/auth/confirm-email-change?token=${rawToken}`;
    await this.mailService.sendEmailChangeVerificationEmail(normalizedEmail, confirmUrl);

    // Tripwire to the OLD address: best-effort like the other security
    // notices; observable via mail_send_failures_total on failure.
    try {
      await this.mailService.sendEmailChangeRequestedEmail(user.email, normalizedEmail);
    } catch (error) {
      this.logger.error('Failed to enqueue email change tripwire', error);
    }

    await this.auditService.log({
      action: AUDIT_ACTIONS.AUTH_EMAIL_CHANGE_REQUESTED,
      userId,
      targetType: 'User',
      targetId: userId,
      ipAddress: ip,
      userAgent,
      metadata: { newEmail: normalizedEmail },
    });
  }

  /**
   * Complete an email change from the link mailed to the new address.
   *
   * Public (the clicker may not be signed in anywhere), so per-IP rate limited
   * as the token brute-force bound like verify-email. On success every session
   * is revoked (`deleteAllUserSessions` bumps the session epoch, the same
   * fence password change/reset ride) because each session blob snapshots
   * the login email and the login identity just changed. The caller signs in
   * again with the new address.
   */
  async confirmEmailChange(token: string, ip: string): Promise<void> {
    await this.shared.enforceAuthRateLimit('confirm-email-change', ip);

    const tokenHash = sha256Hex(token);
    // GETDEL: destroyed on first touch, so two racing confirmations cannot
    // both pass, and a failed confirm burns the link (matching the OAuth
    // state discipline: retry means re-request).
    const raw = await this.redis.getdel(RedisKeys.emailChange(tokenHash));
    const pending = this.parsePending(raw);
    if (!pending) {
      throw new ValidationError(AppErrorCode.INVALID_TOKEN, AppErrorCode.INVALID_TOKEN);
    }

    // Drop the per-user index only if it still points at THIS token: a
    // concurrent newer request owns the key otherwise.
    const indexed = await this.redis.get(RedisKeys.emailChangeUser(pending.userId));
    if (indexed === tokenHash) {
      await this.redis.del(RedisKeys.emailChangeUser(pending.userId));
    }

    const user = await this.userService.findById(pending.userId);
    if (!user) {
      // Deleted account; INVALID_TOKEN (not NOT_FOUND) so account state is
      // not revealed to a link holder.
      throw new ValidationError(AppErrorCode.INVALID_TOKEN, AppErrorCode.INVALID_TOKEN);
    }
    const previousEmail = user.email;

    try {
      await this.prismaService.client.$transaction(async (tx) => {
        // Guarded by the soft-delete filter like password-reset: a user who
        // deleted their account while holding a live link must not write onto
        // the deleted row. `emailVerified: true` because consuming this link
        // IS the verification of the new address.
        const updated = await tx.user.updateMany({
          where: { id: pending.userId, deletedAt: null },
          data: { email: pending.newEmail, emailVerified: true },
        });
        if (updated.count === 0) {
          throw new ValidationError(AppErrorCode.INVALID_TOKEN, AppErrorCode.INVALID_TOKEN);
        }

        // Outstanding links mailed to the OLD address die with the identity
        // switch: a pre-issued PASSWORD_RESET token is an account-takeover
        // lever for whoever controls the old mailbox afterwards (the same
        // reasoning password change applies), and a stale EMAIL_VERIFICATION
        // token is plain hygiene.
        await this.tokenService.invalidateUserTokens(pending.userId, TokenType.PASSWORD_RESET, tx);
        await this.tokenService.invalidateUserTokens(
          pending.userId,
          TokenType.EMAIL_VERIFICATION,
          tx,
        );
      });
    } catch (error) {
      // The pre-check at request time is best-effort: the address can be
      // registered during the confirmation window and trip the User.email
      // unique constraint here. Same duck-typed P2002 mapping as register.
      if (isPrismaUniqueConstraintError(error)) {
        const target = uniqueConstraintTargetText(error);
        if (target === undefined || target.includes('email')) {
          throw new ValidationError(AppErrorCode.EMAIL_IN_USE, AppErrorCode.EMAIL_IN_USE);
        }
      }
      throw error;
    }

    // Revoke every session AND bump the epoch (deleteAllUserSessions does
    // both), the convention every credential-surgery flow follows. Trusted
    // 2FA devices survive deliberately: the second factor did not change.
    await this.sessionRevocation.revokeAllAndDisconnect(pending.userId);

    await this.auditService.log({
      action: AUDIT_ACTIONS.AUTH_EMAIL_CHANGED,
      userId: pending.userId,
      targetType: 'User',
      targetId: pending.userId,
      ipAddress: ip,
      before: { email: previousEmail },
      after: { email: pending.newEmail },
    });
  }

  /**
   * Kill the user's pending email change, if any. Called by password change
   * and password reset: the tripwire tells a victim to rotate the credential,
   * and rotating it must strand the attacker's confirmation link; otherwise
   * the attacker's own mailbox still holds a live identity-switch lever.
   */
  async invalidatePending(userId: string): Promise<void> {
    const tokenHash = await this.redis.getdel(RedisKeys.emailChangeUser(userId));
    if (tokenHash) {
      await this.redis.del(RedisKeys.emailChange(tokenHash));
    }
  }

  private parsePending(raw: string | null): z.infer<typeof pendingEmailChangeSchema> | null {
    if (!raw) return null;
    try {
      return pendingEmailChangeSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }
}
