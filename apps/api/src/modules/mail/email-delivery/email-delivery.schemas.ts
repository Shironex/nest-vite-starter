import { z } from 'zod';
import type {
  ISendPasswordChangedJobData,
  ISendPasswordResetJobData,
  ISendVerificationJobData,
  ISendWelcomeJobData,
  ISendTwoFactorEnabledJobData,
  ISendTwoFactorDisabledJobData,
  ISendRecoveryCodeUsedJobData,
  ISendTwoFactorAdminResetJobData,
  ISendTwoFactorPolicyAnnouncementJobData,
  ISendTwoFactorEnforcementReminderJobData,
  ISendTwoFactorSupportResetContestJobData,
  ISendEmailChangeVerificationJobData,
  ISendEmailChangeRequestedJobData,
  ISendStaffInviteJobData,
  ISendStaffInviteJoinAndCloseJobData,
} from './email-delivery.types';

/**
 * Runtime schemas for the email-delivery job payloads, one per job name.
 * The interfaces in email-delivery.types.ts type the PRODUCER side; these
 * validate what the WORKER reads back from Redis (see
 * common/queue/job-payload.ts for why a compile-time cast is not enough).
 * Default zod strip mode is deliberate: the reserved `withJobContext`
 * siblings (`_ctx`, `_traceparent`, `_tracestate`) ride on top of the payload
 * and are dropped by parsing. `satisfies z.ZodType<...>` keeps each schema
 * structurally locked to its interface.
 */
export const sendVerificationJobSchema = z.object({
  to: z.string().min(1),
  props: z.object({
    verificationUrl: z.string().min(1),
    appName: z.string().min(1),
    // Optional: the template carries a default, and jobs enqueued before this
    // field existed must still parse when the worker drains them.
    expiresIn: z.string().min(1).optional(),
  }),
}) satisfies z.ZodType<ISendVerificationJobData>;

export const sendPasswordResetJobSchema = z.object({
  to: z.string().min(1),
  props: z.object({
    resetUrl: z.string().min(1),
    ipAddress: z.string(),
    appName: z.string().min(1),
    // Optional: see sendVerificationJobSchema.
    expiresIn: z.string().min(1).optional(),
  }),
}) satisfies z.ZodType<ISendPasswordResetJobData>;

export const sendWelcomeJobSchema = z.object({
  to: z.string().min(1),
  props: z.object({
    loginUrl: z.string().min(1),
    appName: z.string().min(1),
  }),
}) satisfies z.ZodType<ISendWelcomeJobData>;

export const sendPasswordChangedJobSchema = z.object({
  to: z.string().min(1),
  props: z.object({
    appName: z.string().min(1),
  }),
}) satisfies z.ZodType<ISendPasswordChangedJobData>;

export const sendTwoFactorEnabledJobSchema = z.object({
  to: z.string().min(1),
  props: z.object({
    appName: z.string().min(1),
    settingsUrl: z.string().min(1),
  }),
}) satisfies z.ZodType<ISendTwoFactorEnabledJobData>;

export const sendTwoFactorDisabledJobSchema = z.object({
  to: z.string().min(1),
  props: z.object({
    appName: z.string().min(1),
    settingsUrl: z.string().min(1),
  }),
}) satisfies z.ZodType<ISendTwoFactorDisabledJobData>;

export const sendRecoveryCodeUsedJobSchema = z.object({
  to: z.string().min(1),
  props: z.object({
    appName: z.string().min(1),
    settingsUrl: z.string().min(1),
  }),
}) satisfies z.ZodType<ISendRecoveryCodeUsedJobData>;

export const sendTwoFactorAdminResetJobSchema = z.object({
  to: z.string().min(1),
  props: z.object({
    appName: z.string().min(1),
  }),
}) satisfies z.ZodType<ISendTwoFactorAdminResetJobData>;

export const sendTwoFactorPolicyAnnouncementJobSchema = z.object({
  to: z.string().min(1),
  props: z.object({
    appName: z.string().min(1),
    settingsUrl: z.string().min(1),
    deadline: z.string().min(1),
  }),
}) satisfies z.ZodType<ISendTwoFactorPolicyAnnouncementJobData>;

export const sendTwoFactorEnforcementReminderJobSchema = z.object({
  to: z.string().min(1),
  props: z.object({
    appName: z.string().min(1),
    settingsUrl: z.string().min(1),
    deadline: z.string().min(1),
  }),
}) satisfies z.ZodType<ISendTwoFactorEnforcementReminderJobData>;

export const sendTwoFactorSupportResetContestJobSchema = z.object({
  to: z.string().min(1),
  props: z.object({
    appName: z.string().min(1),
    ticketRef: z.string().min(1),
    contestDeadline: z.string().min(1),
  }),
}) satisfies z.ZodType<ISendTwoFactorSupportResetContestJobData>;

export const sendEmailChangeVerificationJobSchema = z.object({
  to: z.string().min(1),
  props: z.object({
    confirmUrl: z.string().min(1),
    appName: z.string().min(1),
    // Optional: see sendVerificationJobSchema.
    expiresIn: z.string().min(1).optional(),
  }),
}) satisfies z.ZodType<ISendEmailChangeVerificationJobData>;

export const sendEmailChangeRequestedJobSchema = z.object({
  to: z.string().min(1),
  props: z.object({
    appName: z.string().min(1),
    newEmail: z.string().min(1),
    settingsUrl: z.string().min(1),
  }),
}) satisfies z.ZodType<ISendEmailChangeRequestedJobData>;

export const sendStaffInviteJobSchema = z.object({
  to: z.string().min(1),
  props: z.object({
    inviteUrl: z.string().min(1),
    appName: z.string().min(1),
    organizationName: z.string().min(1),
    // Optional: an organization account need not carry a display name.
    inviterName: z.string().min(1).optional(),
    // Optional: see sendVerificationJobSchema.
    expiresIn: z.string().min(1).optional(),
  }),
}) satisfies z.ZodType<ISendStaffInviteJobData>;

export const sendStaffInviteJoinAndCloseJobSchema = z.object({
  to: z.string().min(1),
  props: z.object({
    inviteUrl: z.string().min(1),
    appName: z.string().min(1),
    organizationName: z.string().min(1),
    inviterName: z.string().min(1).optional(),
    expiresIn: z.string().min(1).optional(),
  }),
}) satisfies z.ZodType<ISendStaffInviteJoinAndCloseJobData>;
