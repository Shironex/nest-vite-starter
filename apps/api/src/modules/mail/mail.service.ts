import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  EMAIL_CHANGE_TOKEN_TTL_MS,
  formatTokenTtl,
  formatTokenTtlDays,
  PASSWORD_RESET_TOKEN_TTL_MS,
  STAFF_INVITE_TOKEN_TTL_MS,
  VERIFICATION_TOKEN_TTL_MS,
} from '@repo/shared/constants';
import { withJobContext } from '../../common/queue';
import { getRequestContext } from '../../common/context/request-context';
import { sha256Hex } from '../../common/utils/crypto';
import { mailSendFailuresTotal } from '../metrics/metrics.registry';
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
    try {
      await this.queue.add(
        EMAIL_DELIVERY_JOB_NAMES.SEND_VERIFICATION,
        withJobContext({
          to,
          props: {
            verificationUrl,
            appName: this.appName,
            // Expiry prose follows the real TTL (shared constant).
            expiresIn: formatTokenTtl(VERIFICATION_TOKEN_TTL_MS),
          },
        }),
        { jobId },
      );
    } catch (error) {
      // A failed CRITICAL enqueue means the mail never reached the retry/DLQ
      // machinery: count it so the MailSendFailures alert fires, then rethrow
      // for the caller to translate (register reports emailSent: false;
      // forgot-password/resend log and stay silent).
      mailSendFailuresTotal.inc({ template: EMAIL_DELIVERY_JOB_NAMES.SEND_VERIFICATION });
      throw error;
    }
    // Recipient is intentionally not logged.
    this.logger.log('Verification email enqueued');
  }

  /** Enqueue the password reset link with IP context. QUEUED (critical class). */
  async sendPasswordResetEmail(to: string, resetUrl: string, ipAddress: string): Promise<void> {
    // Same dedupe scheme as verification: one id per single-use reset token
    // (hashed out of the URL), so duplicates collapse and each new
    // forgot-password request (new token) still sends.
    const jobId = `password-reset-${sha256Hex(resetUrl)}`;
    try {
      await this.queue.add(
        EMAIL_DELIVERY_JOB_NAMES.SEND_PASSWORD_RESET,
        withJobContext({
          to,
          props: {
            resetUrl,
            ipAddress,
            appName: this.appName,
            // Expiry prose follows the real TTL (shared constant).
            expiresIn: formatTokenTtl(PASSWORD_RESET_TOKEN_TTL_MS),
          },
        }),
        { jobId },
      );
    } catch (error) {
      mailSendFailuresTotal.inc({ template: EMAIL_DELIVERY_JOB_NAMES.SEND_PASSWORD_RESET });
      throw error;
    }
    this.logger.log('Password reset email enqueued');
  }

  /** Enqueue the welcome email after verification. QUEUED (non-critical class). */
  async sendWelcomeEmail(to: string, loginUrl: string, userId: string): Promise<void> {
    // welcome-{userId}: a user is welcomed once (email verification is
    // single-use), so the user id alone is the natural dedupe key; a producer
    // retry inside the completed-set retention window collapses to one mail.
    await this.queue.add(
      EMAIL_DELIVERY_JOB_NAMES.SEND_WELCOME,
      withJobContext({ to, props: { loginUrl, appName: this.appName } }),
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
      withJobContext({ to, props: { appName: this.appName } }),
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
      withJobContext({ to, props: { appName: this.appName, settingsUrl: this.settingsUrl() } }),
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
      withJobContext({ to, props: { appName: this.appName, settingsUrl: this.settingsUrl() } }),
      { priority: EMAIL_DELIVERY_NON_CRITICAL_PRIORITY, ...(jobId ? { jobId } : {}) },
    );
    this.logger.log('Two-factor disabled email enqueued');
  }

  /** Enqueue the recovery-code-used security notification. QUEUED (non-critical class). */
  async sendRecoveryCodeUsedEmail(to: string): Promise<void> {
    const jobId = this.requestScopedJobId('recovery-code-used');
    await this.queue.add(
      EMAIL_DELIVERY_JOB_NAMES.SEND_RECOVERY_CODE_USED,
      withJobContext({ to, props: { appName: this.appName, settingsUrl: this.settingsUrl() } }),
      { priority: EMAIL_DELIVERY_NON_CRITICAL_PRIORITY, ...(jobId ? { jobId } : {}) },
    );
    this.logger.log('Recovery code used email enqueued');
  }

  /** Enqueue the OAuth account-linked tripwire. QUEUED (non-critical class). */
  async sendOAuthAccountLinkedEmail(to: string, providerName: string): Promise<void> {
    // Same request-scoped dedupe as the other security notifications: one
    // tripwire per link action, keyed on the originating request so a producer
    // retry inside one request collapses while a later distinct link (new
    // request) still notifies.
    const jobId = this.requestScopedJobId('oauth-account-linked');
    await this.queue.add(
      EMAIL_DELIVERY_JOB_NAMES.SEND_OAUTH_ACCOUNT_LINKED,
      withJobContext({
        to,
        props: {
          appName: this.appName,
          providerName,
          settingsUrl: this.settingsUrl(),
          // "Wasn't you?" starts at a password reset: it replaces the
          // password and ends every session, which unlinking alone does not.
          resetPasswordUrl: this.forgotPasswordUrl(),
        },
      }),
      { priority: EMAIL_DELIVERY_NON_CRITICAL_PRIORITY, ...(jobId ? { jobId } : {}) },
    );
    this.logger.log('OAuth account linked email enqueued');
  }

  /** Enqueue the admin-initiated 2FA reset notification. QUEUED (non-critical class). */
  async sendTwoFactorAdminResetEmail(to: string): Promise<void> {
    const jobId = this.requestScopedJobId('two-factor-admin-reset');
    await this.queue.add(
      EMAIL_DELIVERY_JOB_NAMES.SEND_TWO_FACTOR_ADMIN_RESET,
      withJobContext({ to, props: { appName: this.appName } }),
      { priority: EMAIL_DELIVERY_NON_CRITICAL_PRIORITY, ...(jobId ? { jobId } : {}) },
    );
    this.logger.log('Two-factor admin reset email enqueued');
  }

  /** Enqueue the org-wide 2FA policy announcement with its grace deadline. QUEUED (non-critical class). */
  async sendTwoFactorPolicyAnnouncementEmail(to: string, graceEndsAt: Date): Promise<void> {
    // Deterministic id keyed on (recipient + deadline instant): a cron may
    // enqueue the announcement, so a repeated tick for the same recipient and
    // the same grace window collapses to one mail. A new policy window (new
    // graceEndsAt) yields a fresh id and re-announces. Hashed because the
    // recipient address can contain characters BullMQ rejects in a job id.
    const jobId = `two-factor-policy-announcement-${sha256Hex(`${to}:${graceEndsAt.getTime()}`)}`;
    await this.queue.add(
      EMAIL_DELIVERY_JOB_NAMES.SEND_TWO_FACTOR_POLICY_ANNOUNCEMENT,
      withJobContext({
        to,
        props: {
          appName: this.appName,
          settingsUrl: this.settingsUrl(),
          deadline: graceEndsAt.toUTCString(),
        },
      }),
      { priority: EMAIL_DELIVERY_NON_CRITICAL_PRIORITY, jobId },
    );
    this.logger.log('Two-factor policy announcement email enqueued');
  }

  /** Enqueue the 2FA enforcement reminder before the grace deadline. QUEUED (non-critical class). */
  async sendTwoFactorEnforcementReminderEmail(to: string, graceEndsAt: Date): Promise<void> {
    // Same deterministic (recipient + deadline instant) key as the
    // announcement: a reminder cron for the same recipient and grace window is
    // idempotent, so a doubled tick sends one reminder, not two.
    const jobId = `two-factor-enforcement-reminder-${sha256Hex(`${to}:${graceEndsAt.getTime()}`)}`;
    await this.queue.add(
      EMAIL_DELIVERY_JOB_NAMES.SEND_TWO_FACTOR_ENFORCEMENT_REMINDER,
      withJobContext({
        to,
        props: {
          appName: this.appName,
          settingsUrl: this.settingsUrl(),
          deadline: graceEndsAt.toUTCString(),
        },
      }),
      { priority: EMAIL_DELIVERY_NON_CRITICAL_PRIORITY, jobId },
    );
    this.logger.log('Two-factor enforcement reminder email enqueued');
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
      withJobContext({
        to,
        props: {
          appName: this.appName,
          ticketRef,
          contestDeadline: contestUntil.toUTCString(),
        },
      }),
      { priority: EMAIL_DELIVERY_NON_CRITICAL_PRIORITY, jobId },
    );
    this.logger.log('Two-factor support reset contest email enqueued');
  }

  /**
   * Enqueue the email-change confirmation link, mailed to the NEW address
   *. QUEUED (critical class): like send-verification, the flow
   * cannot complete without this mail, so an enqueue failure is counted,
   * alerted and rethrown for the caller to translate.
   */
  async sendEmailChangeVerificationEmail(to: string, confirmUrl: string): Promise<void> {
    // Same dedupe scheme as verification: the URL embeds the single-use raw
    // token, so hashing it yields one id per token; accidental producer
    // duplicates collapse while every new request (new token) sends.
    const jobId = `email-change-verification-${sha256Hex(confirmUrl)}`;
    try {
      await this.queue.add(
        EMAIL_DELIVERY_JOB_NAMES.SEND_EMAIL_CHANGE_VERIFICATION,
        withJobContext({
          to,
          props: {
            confirmUrl,
            appName: this.appName,
            // Expiry prose follows the real TTL (shared constant).
            expiresIn: formatTokenTtl(EMAIL_CHANGE_TOKEN_TTL_MS),
          },
        }),
        { jobId },
      );
    } catch (error) {
      mailSendFailuresTotal.inc({
        template: EMAIL_DELIVERY_JOB_NAMES.SEND_EMAIL_CHANGE_VERIFICATION,
      });
      throw error;
    }
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
      withJobContext({
        to,
        props: { appName: this.appName, newEmail, settingsUrl: this.settingsUrl() },
      }),
      { priority: EMAIL_DELIVERY_NON_CRITICAL_PRIORITY, ...(jobId ? { jobId } : {}) },
    );
    this.logger.log('Email change requested email enqueued');
  }

  /**
   * Enqueue a staff invitation into an existing organization. CRITICAL class: the
   * invitee has no account they can sign into yet and no way to ask for
   * another link, so a silently dropped mail is a
   * colleague who can never join.
   *
   * `movesExistingAccount` picks the TEMPLATE rather than a paragraph inside
   * one. On that path, accepting moves the reader's account into this organization and
   * closes the one they are in today, and an invitation that changes account
   * ownership without saying so is a phishing template. Routing on the flag here
   * keeps that choice next to the fact it follows from.
   */
  async sendStaffInviteEmail(
    to: string,
    inviteUrl: string,
    organizationName: string,
    options: { inviterName?: string | undefined; movesExistingAccount: boolean },
  ): Promise<void> {
    const jobName = options.movesExistingAccount
      ? EMAIL_DELIVERY_JOB_NAMES.SEND_STAFF_INVITE_JOIN_AND_CLOSE
      : EMAIL_DELIVERY_JOB_NAMES.SEND_STAFF_INVITE;
    // Dedupe on the invite URL: it embeds the single-use
    // raw token, so hashing it yields one id per token. A re-invite mints a new
    // token and therefore a new id, which is what makes "invite again" work
    // while a double-submit collapses. The job name is part of the id so a
    // token that somehow reached both paths cannot have one collapse the other.
    const jobId = `${jobName}-${sha256Hex(inviteUrl)}`;
    try {
      await this.queue.add(
        jobName,
        withJobContext({
          to,
          props: {
            inviteUrl,
            appName: this.appName,
            organizationName,
            ...(options.inviterName ? { inviterName: options.inviterName } : {}),
            // Expiry prose follows the real TTL (shared constant).
            expiresIn: formatTokenTtlDays(STAFF_INVITE_TOKEN_TTL_MS),
          },
        }),
        { jobId },
      );
    } catch (error) {
      mailSendFailuresTotal.inc({ template: jobName });
      throw error;
    }
    // Recipient is intentionally not logged.
    this.logger.log('Staff invite email enqueued');
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
