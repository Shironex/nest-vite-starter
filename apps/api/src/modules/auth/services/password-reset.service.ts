import { Injectable, Logger } from '@nestjs/common';
import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { ValidationError } from '../../../common/errors';
import { PasswordService } from './password.service';
import { TokenService, TokenType } from './token.service';
import { AuthSharedService } from './auth-shared.service';
import { StepUpService } from './step-up.service';
import { TrustedDeviceService } from './trusted-device.service';
import { EmailChangeService } from './email-change.service';
import { UserService } from '../../user/user.service';
import { MailService } from '../../mail/mail.service';
import { SessionRevocationService } from '../../events/session-revocation.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { SecondFactorRepository } from '../repositories/second-factor.repository';
import {} from '../auth.constants';
import {} from '../two-factor.util';
import { sha256Hex } from '../../../common/utils/crypto';
import { now } from '../../../common/clock';
import { recordAuthOutcome } from '../../metrics/auth-outcome.recorder';

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly userService: UserService,
    private readonly mailService: MailService,
    private readonly sessionRevocation: SessionRevocationService,
    private readonly prismaService: PrismaService,
    private readonly auditService: AuditService,
    private readonly shared: AuthSharedService,
    private readonly trustedDeviceService: TrustedDeviceService,
    private readonly stepUpService: StepUpService,
    private readonly secondFactorRepository: SecondFactorRepository,
    private readonly emailChangeService: EmailChangeService,
  ) {}

  /**
   * Initiate password reset flow.
   * Always returns success (don't reveal email existence per OWASP).
   */
  async forgotPassword(email: string, turnstileToken: string, ip: string): Promise<void> {
    await this.shared.enforceAuthRateLimit('forgot-password', ip);
    await this.shared.validateTurnstile(turnstileToken, ip);

    const user = await this.userService.findByEmail(email);
    if (!user) {
      // Don't reveal email existence; return silently. Still record so we can
      // detect enumeration probes after the fact.
      await this.auditService.log({
        action: AUDIT_ACTIONS.AUTH_PASSWORD_FORGOT,
        success: false,
        ipAddress: ip,
        metadata: { reason: 'unknown_email' },
      });
      // No userId: none was resolved, which is the anti-enumeration posture.
      recordAuthOutcome({
        flow: 'password_reset',
        outcome: 'forgot_unknown_email',
        kind: 'refusal',
      });
      return;
    }

    // A removed member must not be sent a reset link: they keep their account
    // and their address, and the only barrier left after a successful reset
    // would be the login check. The refusal returns the SAME generic response
    // as an unknown address, so it never becomes an enumeration oracle.
    const eligibility = await this.userService.findPasswordResetEligibility(user.id);
    if (eligibility === null || eligibility.membershipEnded) {
      await this.auditService.log({
        action: AUDIT_ACTIONS.AUTH_PASSWORD_FORGOT,
        userId: user.id,
        targetType: 'User',
        targetId: user.id,
        success: false,
        ipAddress: ip,
        metadata: {
          reason: eligibility === null ? 'unknown_email' : 'membership_ended',
        },
      });
      recordAuthOutcome({
        flow: 'password_reset',
        outcome: 'forgot_ineligible',
        kind: 'refusal',
        userId: user.id,
      });
      return;
    }

    const resetToken = await this.tokenService.createPasswordResetToken(user.id);
    const resetUrl = `${this.shared.appUrl}/auth/reset-password?token=${resetToken}`;

    // Await only the ENQUEUE (delivery is async, retried, DLQ-backed). Never
    // throw here: the response must be indistinguishable from the
    // unknown-email branch (anti-enumeration), and the failure is observable
    // via mail_send_failures_total.
    try {
      await this.mailService.sendPasswordResetEmail(user.email, resetUrl, ip);
    } catch (error) {
      this.logger.error('Failed to enqueue password reset email', error);
    }

    await this.auditService.log({
      action: AUDIT_ACTIONS.AUTH_PASSWORD_FORGOT,
      userId: user.id,
      targetType: 'User',
      targetId: user.id,
      ipAddress: ip,
    });
    recordAuthOutcome({
      flow: 'password_reset',
      outcome: 'forgot_sent',
      kind: 'success',
      userId: user.id,
    });
  }

  /**
   * Reset password using token from email.
   * Unlocks account and invalidates all sessions.
   * Per-IP rate limited: tRPC procedures sit outside the global ThrottlerGuard,
   * so the shared Redis fixed window is the brute-force bound for token guessing.
   */
  async resetPassword(
    token: string,
    newPassword: string,
    ip: string,
    factorCode?: string,
  ): Promise<void> {
    await this.shared.enforceAuthRateLimit('reset-password', ip);

    const hashedToken = sha256Hex(token);

    // Validate the token BEFORE the expensive Argon2 hash, so a bad token can't
    // be replayed to burn hashing CPU (hash-amplified DoS). resetPassword has no
    // captcha, so this ordering plus the per-IP limit above is the DoS guard.
    const tokenRecord = await this.prismaService.client.token.findFirst({
      where: { token: hashedToken, type: TokenType.PASSWORD_RESET },
    });
    if (!tokenRecord || tokenRecord.expiresAt < now()) {
      // Consume an expired/garbage token if one matched, then reject.
      if (tokenRecord) {
        await this.prismaService.client.token.deleteMany({ where: { id: tokenRecord.id } });
      }
      // Token guessing is the shape this counter exists to make visible: a
      // climbing `bad_token` rate on a flow with no captcha is an attack.
      recordAuthOutcome({
        flow: 'password_reset',
        outcome: 'bad_token',
        kind: 'refusal',
        ...(tokenRecord ? { userId: tokenRecord.userId } : {}),
      });
      throw new ValidationError(AppErrorCode.INVALID_TOKEN, AppErrorCode.INVALID_TOKEN);
    }

    // 2FA gate: when the account has an active non-recovery factor, the mailbox
    // alone must not be sufficient to change the password (closes the
    // mailbox-only lockout attack). Requires a current TOTP or recovery code,
    // sharing the manage rate limit and audit reason of the challenge flow.
    // The tenant is stamped explicitly because reset runs unauthenticated: see
    // resolveAuditTenantId below for why a null there does not stay null.
    await this.stepUpService.assertSecondFactor({
      userId: tokenRecord.userId,
      code: factorCode,
      ip,
      context: 'password_reset',
      tenantId: await this.resolveAuditTenantId(tokenRecord.userId),
      onRefused: () =>
        recordAuthOutcome({
          flow: 'password_reset',
          outcome: 'bad_second_factor',
          kind: 'refusal',
          userId: tokenRecord.userId,
        }),
    });

    const passwordHash = await this.passwordService.hash(newPassword);

    // Atomic single-use consume + password update + account unlock. The guarded
    // deleteMany makes the token strictly one-time even under concurrent resets:
    // only the caller that deletes the row (count > 0) proceeds.
    const userId = await this.prismaService.client.$transaction(async (tx) => {
      const consumed = await tx.token.deleteMany({
        where: { id: tokenRecord.id, token: hashedToken },
      });
      if (consumed.count === 0) {
        throw new ValidationError(AppErrorCode.INVALID_TOKEN, AppErrorCode.INVALID_TOKEN);
      }

      // Guarded by the soft-delete filter: a user who deleted their account
      // while holding a live reset token must not be able to write a new
      // credential onto the deleted row. Zero rows throws (INVALID_TOKEN, not
      // NOT_FOUND, so account state is not revealed) and rolls the consume
      // back; the dangling token dies with the row at purge anyway.
      const updated = await tx.user.updateMany({
        // `membershipEndedAt` alongside the soft-delete filter, for the same
        // reason: a removed member holding a live reset token must not be able
        // to write a new credential onto a row that the login door refuses. Zero
        // rows throws INVALID_TOKEN, not NOT_FOUND, so the account's state is
        // not readable from the link.
        where: { id: tokenRecord.userId, deletedAt: null, membershipEndedAt: null },
        data: {
          passwordHash,
          failedAttempts: 0,
          lockoutCount: 0,
          lockedUntil: null,
        },
      });
      if (updated.count === 0) {
        throw new ValidationError(AppErrorCode.INVALID_TOKEN, AppErrorCode.INVALID_TOKEN);
      }

      return tokenRecord.userId;
    });

    // Invalidate all sessions (Redis, outside DB transaction) and drop live
    // sockets in one step.
    await this.sessionRevocation.revokeAllAndDisconnect(userId);
    // A password reset assumes a possible compromise, so pre-authorized browsers
    // are forgotten too (matches the password-change posture).
    await this.trustedDeviceService.revokeAll(userId);
    // A pending email change dies with the credential rotation too (matches
    // the password-change posture; see EmailChangeService).
    await this.emailChangeService.invalidatePending(userId);

    // The audit write and the user fetch are independent, so run them
    // concurrently rather than serially (see login.service.ts).
    const [, user] = await Promise.all([
      this.auditService.log({
        action: AUDIT_ACTIONS.AUTH_PASSWORD_RESET,
        userId,
        tenantId: await this.resolveAuditTenantId(userId),
        targetType: 'User',
        targetId: userId,
      }),
      this.userService.findById(userId),
    ]);
    recordAuthOutcome({ flow: 'password_reset', outcome: 'completed', kind: 'success', userId });

    // Send password changed notification
    if (user) {
      try {
        await this.mailService.sendPasswordChangedEmail(user.email);
      } catch (error) {
        this.logger.error('Failed to send password changed email', error);
      }
    }
  }

  /**
   * Pre-check for the reset form: is this token valid, and does the account have
   * an active factor (so the form must show the code field)? Does NOT consume
   * the token. Revealing "2FA is on" to a holder of a valid reset link is
   * accepted: the link already proves mailbox control.
   */
  async getResetTokenState(
    token: string,
    ip: string,
  ): Promise<{ valid: boolean; requiresTwoFactor: boolean }> {
    await this.shared.enforceAuthRateLimit('reset-password', ip);
    const hashedToken = sha256Hex(token);
    const tokenRecord = await this.prismaService.client.token.findFirst({
      where: { token: hashedToken, type: TokenType.PASSWORD_RESET },
    });
    if (!tokenRecord || tokenRecord.expiresAt < now()) {
      return { valid: false, requiresTwoFactor: false };
    }
    const activeFactor = await this.secondFactorRepository.findActiveNonRecovery(
      tokenRecord.userId,
    );
    return { valid: true, requiresTwoFactor: activeFactor !== null };
  }

  /**
   * The organization an auth audit row belongs to.
   *
   * Reset runs unauthenticated, so AuthMiddleware never seeds the ALS and
   * AuditService would stamp `tenantId: null`. A tenant-less row is attributed
   * through the actor's CURRENT tenant by audit-read.repository, so it would
   * silently move to whatever organization the account later joins. Stamping it here
   * pins the row to the organization the reset actually happened in, and the read
   * side's null arm goes back to covering only rows that genuinely belong to no
   * organization (unknown-email failures, system crons).
   *
   * A direct projection rather than `userService.findById`, whose
   * credential-free select does not carry `tenantId`. `user` is not a
   * tenant-scoped model, so this read is legal with no ALS context; a
   * soft-deleted account still answers, which is what an audit stamp wants.
   */
  private async resolveAuditTenantId(userId: string): Promise<string | null> {
    const row = await this.prismaService.client.user.findUnique({
      where: { id: userId },
      select: { tenantId: true },
    });
    return row?.tenantId ?? null;
  }
}
