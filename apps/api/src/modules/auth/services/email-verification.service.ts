import { Injectable, Logger } from '@nestjs/common';
import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { NotFoundError, ValidationError } from '../../../common/errors';
import { TokenService, TokenType } from './token.service';
import { AuthSharedService } from './auth-shared.service';
import { UserService } from '../../user/user.service';
import { MailService } from '../../mail/mail.service';
import { AuditService } from '../../audit/audit.service';
import { SessionRevocationService } from '../../events/session-revocation.service';
import { PrismaService } from '../../../common/database/prisma.service';

/** Fixed window for verification-email resends. */
const RESEND_WINDOW_SECONDS = 60 * 60; // 1 hour
const MAX_RESEND_PER_WINDOW = 3;

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly tokenService: TokenService,
    private readonly userService: UserService,
    private readonly mailService: MailService,
    private readonly auditService: AuditService,
    private readonly prismaService: PrismaService,
    private readonly shared: AuthSharedService,
    private readonly sessionRevocation: SessionRevocationService,
  ) {}

  /**
   * Verify email with token from verification link.
   *
   * The token consume and the emailVerified flip run in ONE transaction
   * (mirroring password-reset): the consume is the single-use gate, so a
   * crash between a standalone consume and the user update would burn the
   * token without verifying the email, stranding the user.
   *
   * Per-IP rate limited: tRPC procedures sit outside the global ThrottlerGuard,
   * so the shared Redis fixed window is the brute-force bound for token guessing.
   *
   * Every session is revoked once the address is verified (account
   * pre-hijacking): registration opens a session before anyone proves control
   * of the inbox, so a session minted then may belong to whoever typed the
   * address, not to its owner. The session presenting this request dies too,
   * deliberately: the procedure is public and the token, not a cookie, is what
   * proves ownership here, so the simplest correct rule is that nothing
   * minted before verification survives it. The owner signs in again.
   */
  async verifyEmail(token: string, ip: string): Promise<void> {
    await this.shared.enforceAuthRateLimit('verify-email', ip);

    const userId = await this.prismaService.client.$transaction(async (tx) => {
      const result = await this.tokenService.validateToken(token, TokenType.EMAIL_VERIFICATION, tx);

      if (!result) {
        throw new ValidationError(AppErrorCode.INVALID_TOKEN, AppErrorCode.INVALID_TOKEN);
      }

      await this.userService.verifyEmail(result.userId, tx);
      return result.userId;
    });

    // Redis, outside the DB transaction and only after it committed, the order
    // deleteAllUserSessions requires of every caller (as password reset does).
    await this.sessionRevocation.revokeAllAndDisconnect(userId);

    // The audit write and the user fetch are independent, so run them
    // concurrently rather than serially (see login.service.ts).
    const [, user] = await Promise.all([
      this.auditService.log({
        action: AUDIT_ACTIONS.AUTH_EMAIL_VERIFIED,
        userId,
        targetType: 'User',
        targetId: userId,
      }),
      this.userService.findById(userId),
    ]);

    // Send welcome email
    if (user) {
      const loginUrl = `${this.shared.appUrl}/auth/login`;
      try {
        await this.mailService.sendWelcomeEmail(user.email, loginUrl, user.id);
      } catch (error) {
        this.logger.error('Failed to send welcome email', error);
      }
    }
  }

  /**
   * Resend verification email.
   * Rate limited: max 3 per hour per user (Redis fixed window). Counting DB
   * token rows cannot work here: createVerificationToken deletes the previous
   * row first, so the count never exceeded 1.
   */
  async resendVerification(userId: string, turnstileToken: string, ip?: string): Promise<void> {
    await this.shared.validateTurnstile(turnstileToken, ip);

    await this.shared.enforceRateLimit(
      `resend-verification:${userId}`,
      MAX_RESEND_PER_WINDOW,
      RESEND_WINDOW_SECONDS,
    );

    const user = await this.userService.findById(userId);
    if (!user) {
      await this.auditService.log({
        action: AUDIT_ACTIONS.AUTH_EMAIL_VERIFICATION_RESENT,
        userId,
        targetType: 'User',
        targetId: userId,
        success: false,
        ...(ip === undefined ? {} : { ipAddress: ip }),
        metadata: { reason: 'unknown_user' },
      });
      throw new NotFoundError();
    }

    const verificationToken = await this.tokenService.createVerificationToken(userId);
    const verificationUrl = `${this.shared.appUrl}/auth/verify-email?token=${verificationToken}`;
    // Await only the ENQUEUE (delivery is async, retried, DLQ-backed). Enqueue
    // failures are logged but not thrown, mirroring forgot-password's
    // tolerance; the failure is observable via mail_send_failures_total.
    try {
      await this.mailService.sendVerificationEmail(user.email, verificationUrl);
    } catch (error) {
      this.logger.error('Failed to enqueue verification email on resend', error);
    }

    // After the enqueue attempt, like forgot-password: the row records that the
    // rotation happened and the mail was attempted, which is the pair a reader
    // needs. Written outside createVerificationToken because that rotation runs
    // in a transaction and an audit write may not.
    await this.auditService.log({
      action: AUDIT_ACTIONS.AUTH_EMAIL_VERIFICATION_RESENT,
      userId,
      targetType: 'User',
      targetId: userId,
      ...(ip === undefined ? {} : { ipAddress: ip }),
    });
  }
}
