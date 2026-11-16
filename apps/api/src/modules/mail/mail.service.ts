import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  EMAIL_CHANGE_TOKEN_TTL_MS,
  formatTokenTtl,
  PASSWORD_RESET_TOKEN_TTL_MS,
  VERIFICATION_TOKEN_TTL_MS,
} from '@repo/shared/constants';
import { getRequestContext } from '../../common/context/request-context';
import { sha256Hex } from '../../common/utils/crypto';
import {
  EMAIL_DELIVERY_JOB_NAMES,
  EMAIL_DELIVERY_NON_CRITICAL_PRIORITY,
  EMAIL_DELIVERY_QUEUE_NAME,
} from './email-delivery/email-delivery.constants';
import type { EmailDeliveryJobData } from './email-delivery/email-delivery.types';

/**
 * Email facade. Method signatures are unchanged so auth callers are untouched;
 * the producer is enqueue-only and ALL mail rides the email-delivery queue
 * (retry + bounded DLQ per EMAIL_DELIVERY_DEFAULTS), split by criticality:
 *
 *   - Critical transactional auth mail (verification, password reset) enqueues
 *     in the highest-priority class (no priority option; BullMQ drains the
 *     plain wait list before the prioritized set). It used to be sent inline
 *     so a failure surfaced to the caller, but the SMTP roundtrip sat on the
 *     p95 of register/forgot-password/resend-verification and gave the
 *     known-email branch a ~1s timing signal (enumeration). Callers now await
 *     only the enqueue: register reports an enqueue failure as
 *     `emailSent: false`; forgot-password/resend log and stay silent per the
 *     anti-enumeration design.
 *   - Non-critical mail (welcome, password-changed) enqueues in the lower
 *     priority class so a burst of it never delays auth mail. These were
 *     already best-effort at every call site.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly appName: string;
  private readonly appUrl: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectQueue(EMAIL_DELIVERY_QUEUE_NAME)
    private readonly queue: Queue<EmailDeliveryJobData>,
  ) {
    this.appName = this.configService.getOrThrow<string>('APP_NAME');
    this.appUrl = this.configService.getOrThrow<string>('APP_URL');
  }

  /** Enqueue the email verification link. QUEUED (critical class). */
  async sendVerificationEmail(to: string, verificationUrl: string): Promise<void> {
    // Deterministic jobId so a producer retry (double-submit, tRPC replay)
    // cannot double-enqueue the SAME mail. The URL embeds the single-use raw
    // token, so hashing it yields one id per token: accidental duplicates
    // collapse while every legitimate resend (which mints a new token) gets a
    // fresh id. Hashed so the raw token never appears as a Redis key or in a
    // queue UI. '-' separator: BullMQ rejects ':' in custom job ids.
    const jobId = `verification-${sha256Hex(verificationUrl)}`;
    await this.queue.add(
      EMAIL_DELIVERY_JOB_NAMES.SEND_VERIFICATION,
      {
        to,
        props: {
          verificationUrl,
          appName: this.appName,
          // Expiry prose follows the real TTL (shared constant).
          expiresIn: formatTokenTtl(VERIFICATION_TOKEN_TTL_MS),
        },
      },
      { jobId },
    );
    // Recipient is intentionally not logged.
    this.logger.log('Verification email enqueued');
  }

  /** Enqueue the password reset link with IP context. QUEUED (critical class). */
  async sendPasswordResetEmail(to: string, resetUrl: string, ipAddress: string): Promise<void> {
    // Same dedupe scheme as verification: one id per single-use reset token
    // (hashed out of the URL), so duplicates collapse and each new
    // forgot-password request (new token) still sends.
    const jobId = `password-reset-${sha256Hex(resetUrl)}`;
    await this.queue.add(
      EMAIL_DELIVERY_JOB_NAMES.SEND_PASSWORD_RESET,
      {
        to,
        props: {
          resetUrl,
          ipAddress,
          appName: this.appName,
          // Expiry prose follows the real TTL (shared constant).
          expiresIn: formatTokenTtl(PASSWORD_RESET_TOKEN_TTL_MS),
        },
      },
      { jobId },
    );
    this.logger.log('Password reset email enqueued');
  }

  /** Enqueue the welcome email after verification. QUEUED (non-critical class). */
  async sendWelcomeEmail(to: string, loginUrl: string, userId: string): Promise<void> {
    // welcome-{userId}: a user is welcomed once (email verification is
    // single-use), so the user id alone is the natural dedupe key; a producer
    // retry inside the completed-set retention window collapses to one mail.
    await this.queue.add(
      EMAIL_DELIVERY_JOB_NAMES.SEND_WELCOME,
      { to, props: { loginUrl, appName: this.appName } },
      { priority: EMAIL_DELIVERY_NON_CRITICAL_PRIORITY, jobId: `welcome-${userId}` },
    );
    this.logger.log('Welcome email enqueued');
  }

  /** Enqueue the password-changed notification. QUEUED (non-critical class). */
  async sendPasswordChangedEmail(to: string): Promise<void> {
    // Every password change is a distinct legitimate notification, so the
    // dedupe key is the originating REQUEST: producer retries inside one
    // request collapse, while a second change (new request) still notifies.
    // Shares requestScopedJobId with the other security notifications, so the
    // caller-controlled-key hazard documented there is fixed in one place.
    const jobId = this.requestScopedJobId('password-changed');
    await this.queue.add(
      EMAIL_DELIVERY_JOB_NAMES.SEND_PASSWORD_CHANGED,
      { to, props: { appName: this.appName } },
      { priority: EMAIL_DELIVERY_NON_CRITICAL_PRIORITY, ...(jobId ? { jobId } : {}) },
    );
    this.logger.log('Password changed email enqueued');
  }

  /** Enqueue the two-factor-enabled security confirmation. QUEUED (non-critical class). */
  async sendTwoFactorEnabledEmail(to: string): Promise<void> {
    // Same request-scoped dedupe as two-factor-disabled: one confirmation per
    // activation, keyed on the originating request so a producer retry inside
    // one request collapses. No stable key outside a request context, so no
    // jobId is set there.
    const jobId = this.requestScopedJobId('two-factor-enabled');
    await this.queue.add(
      EMAIL_DELIVERY_JOB_NAMES.SEND_TWO_FACTOR_ENABLED,
      { to, props: { appName: this.appName, settingsUrl: this.settingsUrl() } },
      { priority: EMAIL_DELIVERY_NON_CRITICAL_PRIORITY, ...(jobId ? { jobId } : {}) },
    );
    this.logger.log('Two-factor enabled email enqueued');
  }

  /** Enqueue the two-factor-disabled security notification. QUEUED (non-critical class). */
  async sendTwoFactorDisabledEmail(to: string): Promise<void> {
    // Same request-scoped dedupe as password-changed: one legitimate
    // notification per disable action, keyed on the originating request so a
    // producer retry inside one request collapses. No stable key outside a
    // request context, so no jobId is set there.
    const jobId = this.requestScopedJobId('two-factor-disabled');
    await this.queue.add(
      EMAIL_DELIVERY_JOB_NAMES.SEND_TWO_FACTOR_DISABLED,
      { to, props: { appName: this.appName, settingsUrl: this.settingsUrl() } },
      { priority: EMAIL_DELIVERY_NON_CRITICAL_PRIORITY, ...(jobId ? { jobId } : {}) },
    );
    this.logger.log('Two-factor disabled email enqueued');
  }

  /** Enqueue the recovery-code-used security notification. QUEUED (non-critical class). */
  async sendRecoveryCodeUsedEmail(to: string): Promise<void> {
    const jobId = this.requestScopedJobId('recovery-code-used');
    await this.queue.add(
      EMAIL_DELIVERY_JOB_NAMES.SEND_RECOVERY_CODE_USED,
      { to, props: { appName: this.appName, settingsUrl: this.settingsUrl() } },
      { priority: EMAIL_DELIVERY_NON_CRITICAL_PRIORITY, ...(jobId ? { jobId } : {}) },
    );
    this.logger.log('Recovery code used email enqueued');
  }

  /** Enqueue the admin-initiated 2FA reset notification. QUEUED (non-critical class). */
  async sendTwoFactorAdminResetEmail(to: string): Promise<void> {
    const jobId = this.requestScopedJobId('two-factor-admin-reset');
    await this.queue.add(
      EMAIL_DELIVERY_JOB_NAMES.SEND_TWO_FACTOR_ADMIN_RESET,
      { to, props: { appName: this.appName } },
      { priority: EMAIL_DELIVERY_NON_CRITICAL_PRIORITY, ...(jobId ? { jobId } : {}) },
    );
    this.logger.log('Two-factor admin reset email enqueued');
  }

  /** Enqueue the support-initiated 2FA reset contest window. QUEUED (non-critical class). */
  async sendTwoFactorSupportResetContestEmail(
    to: string,
    ticketRef: string,
    contestUntil: Date,
  ): Promise<void> {
    // Dedupe on the support ticket: one contest notice per ticket (like
    // welcome-{userId}), so a producer retry for the same ticket collapses.
    // Hashed because ticketRef is opaque support-desk text that may contain
    // characters BullMQ rejects in a job id.
    const jobId = `two-factor-support-reset-contest-${sha256Hex(ticketRef)}`;
    await this.queue.add(
      EMAIL_DELIVERY_JOB_NAMES.SEND_TWO_FACTOR_SUPPORT_RESET_CONTEST,
      {
        to,
        props: {
          appName: this.appName,
          ticketRef,
          contestDeadline: contestUntil.toUTCString(),
        },
      },
      { priority: EMAIL_DELIVERY_NON_CRITICAL_PRIORITY, jobId },
    );
    this.logger.log('Two-factor support reset contest email enqueued');
  }

  /**
   * Enqueue the email-change confirmation link, mailed to the NEW address
   *. QUEUED (critical class): like send-verification, the flow
   * cannot complete without this mail, so an enqueue failure propagates for
   * the caller to translate.
   */
  async sendEmailChangeVerificationEmail(to: string, confirmUrl: string): Promise<void> {
    // Same dedupe scheme as verification: the URL embeds the single-use raw
    // token, so hashing it yields one id per token; accidental producer
    // duplicates collapse while every new request (new token) sends.
    const jobId = `email-change-verification-${sha256Hex(confirmUrl)}`;
    await this.queue.add(
      EMAIL_DELIVERY_JOB_NAMES.SEND_EMAIL_CHANGE_VERIFICATION,
      {
        to,
        props: {
          confirmUrl,
          appName: this.appName,
          // Expiry prose follows the real TTL (shared constant).
          expiresIn: formatTokenTtl(EMAIL_CHANGE_TOKEN_TTL_MS),
        },
      },
      { jobId },
    );
    this.logger.log('Email change verification email enqueued');
  }

  /**
   * Enqueue the email-change tripwire to the OLD address. QUEUED
   * (non-critical class): best-effort like the other security notices; the
   * request itself must not fail on a mail outage.
   */
  async sendEmailChangeRequestedEmail(to: string, newEmail: string): Promise<void> {
    // Same request-scoped dedupe as password-changed: one tripwire per request
    // action, so a producer retry inside one request collapses while a second
    // request (new context) still notifies.
    const jobId = this.requestScopedJobId('email-change-requested');
    await this.queue.add(
      EMAIL_DELIVERY_JOB_NAMES.SEND_EMAIL_CHANGE_REQUESTED,
      {
        to,
        props: { appName: this.appName, newEmail, settingsUrl: this.settingsUrl() },
      },
      { priority: EMAIL_DELIVERY_NON_CRITICAL_PRIORITY, ...(jobId ? { jobId } : {}) },
    );
    this.logger.log('Email change requested email enqueued');
  }

  /** Public settings deep-link, sourced from APP_URL (see constructor). */
  private settingsUrl(): string {
    return `${this.appUrl}/settings`;
  }

  /** Public "request a password reset" page, sourced from APP_URL. */
  private forgotPasswordUrl(): string {
    return `${this.appUrl}/auth/forgot-password`;
  }

  /**
   * Request-scoped, stable job id for the notification producers that have no
   * natural domain key (2FA disabled / recovery-code-used / admin-reset): the
   * originating request collapses producer retries within one request, while a
   * later distinct action (new request) still notifies. Undefined outside a
   * request context, where there is no stable key.
   *
   * Keyed on `dedupeNonce`, NOT `requestId`. BullMQ treats a repeated job id as
   * a no-op against the active and completed sets, so whoever controls this
   * value controls whether the mail is sent at all, and `requestId` can come
   * from a caller-supplied `x-request-id` / `traceparent`. Pinning one header
   * across requests would otherwise silently swallow the victim's own
   * security alerts for the queue's retention window.
   */
  private requestScopedJobId(prefix: string): string | undefined {
    const nonce = getRequestContext()?.dedupeNonce;
    return nonce === undefined ? undefined : `${prefix}-${sha256Hex(nonce)}`;
  }
}
