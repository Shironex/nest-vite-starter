import type { IQueueDefaults } from '../../../common/queue/queue.constants';
import { QUEUE_NAMES } from '../../../common/queue/queue.constants';

/** Canonical queue name, referenced through the central registry. */
export const EMAIL_DELIVERY_QUEUE_NAME = QUEUE_NAMES.EMAIL_DELIVERY;

/**
 * Job names for the email-delivery queue. ALL mail rides the queue, split into
 * two priority classes:
 *
 *   - CRITICAL transactional auth mail (verification, password reset) used to
 *     be sent synchronously so a failure surfaced to the user instantly, but
 *     the inline SMTP roundtrip sat on the p95 of register / forgot-password /
 *     resend-verification and made the known-email branch measurably slower
 *     than the unknown-email one (an enumeration timing signal). It now
 *     enqueues at the highest priority; the enqueue failure is what surfaces
 *     to the caller (register reports it as `emailSent: false`), and a
 *     worker-side send failure is retried, alerted via
 *     `mail_send_failures_total`, and retained in the DLQ.
 *   - NON-CRITICAL mail (welcome, password-changed) enqueues at a lower
 *     priority so a burst of it never delays auth mail. These were already
 *     best-effort at every call site.
 */
export const EMAIL_DELIVERY_JOB_NAMES = {
  SEND_VERIFICATION: 'send-verification',
  SEND_PASSWORD_RESET: 'send-password-reset',
  SEND_WELCOME: 'send-welcome',
  SEND_PASSWORD_CHANGED: 'send-password-changed',
  // Two-factor security notifications (non-critical class), added for the 2FA
  // feature. Each is best-effort like password-changed / welcome.
  SEND_TWO_FACTOR_ENABLED: 'send-two-factor-enabled',
  SEND_TWO_FACTOR_DISABLED: 'send-two-factor-disabled',
  SEND_RECOVERY_CODE_USED: 'send-recovery-code-used',
  SEND_TWO_FACTOR_ADMIN_RESET: 'send-two-factor-admin-reset',
  SEND_TWO_FACTOR_POLICY_ANNOUNCEMENT: 'send-two-factor-policy-announcement',
  SEND_TWO_FACTOR_ENFORCEMENT_REMINDER: 'send-two-factor-enforcement-reminder',
  SEND_TWO_FACTOR_SUPPORT_RESET_CONTEST: 'send-two-factor-support-reset-contest',
  // OAuth account-linked tripwire (non-critical class): the security
  // notification sent on every new sign-in-method link. Best-effort like the other security notices: the link
  // itself must not fail on a mail outage.
  SEND_OAUTH_ACCOUNT_LINKED: 'send-oauth-account-linked',
  // Email change. The verification link to the NEW address is
  // critical like send-verification: the flow cannot complete without it. The
  // tripwire to the OLD address is non-critical like the other security
  // notices: the change itself must not fail on a mail outage.
  SEND_EMAIL_CHANGE_VERIFICATION: 'send-email-change-verification',
  SEND_EMAIL_CHANGE_REQUESTED: 'send-email-change-requested',
  // Staff invitation into an existing organization.
  // CRITICAL class: the invitee has no account they can log into yet, and no
  // way to ask for another link.
  SEND_STAFF_INVITE: 'send-staff-invite',
  // The collision twin, sent when the invited address already has an account
  // elsewhere. A separate job name rather than a flag on the one above, for the
  // reason the employer twin gives, plus a stronger one: this mail carries the
  // disclosure that accepting closes the reader's current organization, and a payload
  // discriminant would put that choice in the processor's body where the
  // exhaustive switch cannot see it.
  SEND_STAFF_INVITE_JOIN_AND_CLOSE: 'send-staff-invite-join-and-close',
} as const;

/**
 * Priority for the non-critical mail class. BullMQ drains the plain wait list
 * BEFORE the prioritized set (`moveToActive` pops `wait` first), so critical
 * auth mail is enqueued WITHOUT a priority option (the effective
 * highest-priority class) and non-critical mail is pushed into the prioritized
 * set behind it. Do NOT give critical mail `priority: 1`; that would demote it
 * below every unprioritized job.
 */
export const EMAIL_DELIVERY_NON_CRITICAL_PRIORITY = 10;

export type EmailDeliveryJobName =
  (typeof EMAIL_DELIVERY_JOB_NAMES)[keyof typeof EMAIL_DELIVERY_JOB_NAMES];

/**
 * Retry/backoff/retention policy, applied once at the producer so no call site
 * re-specifies it. Failed jobs are retained as the DLQ for inspection (paired
 * with the `queue_jobs_failed` gauge from `QueueMetricsService`), but bounded to
 * a 7-day window: the failed payload includes the recipient address, so an
 * unbounded DLQ is unbounded PII-at-rest (GDPR). 7 days keeps the debugging
 * window while capping growth; tune it to your own retention policy.
 */
export const EMAIL_DELIVERY_DEFAULTS: IQueueDefaults = {
  jobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 3_600, count: 100 },
    removeOnFail: { age: 604_800 },
  },
  concurrency: 5,
};
