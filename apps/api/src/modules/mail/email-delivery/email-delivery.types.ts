import type {
  VerificationEmailProps,
  PasswordResetEmailProps,
  WelcomeEmailProps,
  PasswordChangedEmailProps,
  TwoFactorEnabledEmailProps,
  TwoFactorDisabledEmailProps,
  RecoveryCodeUsedEmailProps,
  TwoFactorAdminResetEmailProps,
  TwoFactorPolicyAnnouncementEmailProps,
  TwoFactorEnforcementReminderEmailProps,
  TwoFactorSupportResetContestEmailProps,
  EmailChangeVerificationEmailProps,
  EmailChangeRequestedEmailProps,
  StaffInviteEmailProps,
  StaffInviteJoinAndCloseEmailProps,
} from '@repo/email' with {
  'resolution-mode': 'import',
};

/**
 * Typed job-data contract for the email-delivery queue. Each variant carries
 * the recipient plus the exact props its `@repo/email` render fn needs. The
 * BullMQ job NAME is the discriminator (the processor switches on `job.name`),
 * so the variants are distinguished by their structural payload here.
 *
 * The producer wraps these in `withJobContext(...)`, which appends reserved
 * `_ctx` / `_traceparent` keys at the top level; the processor runtime-parses
 * `job.data` against the matching schema in email-delivery.schemas.ts (zod
 * strip mode), so those reserved keys never leak into render input or the
 * outgoing email.
 */
export interface ISendVerificationJobData {
  readonly to: string;
  readonly props: VerificationEmailProps;
}

export interface ISendPasswordResetJobData {
  readonly to: string;
  readonly props: PasswordResetEmailProps;
}

export interface ISendWelcomeJobData {
  readonly to: string;
  readonly props: WelcomeEmailProps;
}

export interface ISendPasswordChangedJobData {
  readonly to: string;
  readonly props: PasswordChangedEmailProps;
}

export interface ISendTwoFactorEnabledJobData {
  readonly to: string;
  readonly props: TwoFactorEnabledEmailProps;
}

export interface ISendTwoFactorDisabledJobData {
  readonly to: string;
  readonly props: TwoFactorDisabledEmailProps;
}

export interface ISendRecoveryCodeUsedJobData {
  readonly to: string;
  readonly props: RecoveryCodeUsedEmailProps;
}

export interface ISendTwoFactorAdminResetJobData {
  readonly to: string;
  readonly props: TwoFactorAdminResetEmailProps;
}

export interface ISendTwoFactorPolicyAnnouncementJobData {
  readonly to: string;
  readonly props: TwoFactorPolicyAnnouncementEmailProps;
}

export interface ISendTwoFactorEnforcementReminderJobData {
  readonly to: string;
  readonly props: TwoFactorEnforcementReminderEmailProps;
}

export interface ISendTwoFactorSupportResetContestJobData {
  readonly to: string;
  readonly props: TwoFactorSupportResetContestEmailProps;
}

export interface ISendEmailChangeVerificationJobData {
  readonly to: string;
  readonly props: EmailChangeVerificationEmailProps;
}

export interface ISendEmailChangeRequestedJobData {
  readonly to: string;
  readonly props: EmailChangeRequestedEmailProps;
}

export interface ISendStaffInviteJobData {
  readonly to: string;
  readonly props: StaffInviteEmailProps;
}

export interface ISendStaffInviteJoinAndCloseJobData {
  readonly to: string;
  readonly props: StaffInviteJoinAndCloseEmailProps;
}

export type EmailDeliveryJobData =
  | ISendVerificationJobData
  | ISendPasswordResetJobData
  | ISendWelcomeJobData
  | ISendPasswordChangedJobData
  | ISendTwoFactorEnabledJobData
  | ISendTwoFactorDisabledJobData
  | ISendRecoveryCodeUsedJobData
  | ISendTwoFactorAdminResetJobData
  | ISendTwoFactorPolicyAnnouncementJobData
  | ISendTwoFactorEnforcementReminderJobData
  | ISendTwoFactorSupportResetContestJobData
  | ISendEmailChangeVerificationJobData
  | ISendEmailChangeRequestedJobData
  | ISendStaffInviteJobData
  | ISendStaffInviteJoinAndCloseJobData;
