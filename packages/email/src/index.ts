import { render } from 'react-email';
import { VerificationEmail, type VerificationEmailProps } from './templates/verification.js';
import { PasswordResetEmail, type PasswordResetEmailProps } from './templates/password-reset.js';
import { WelcomeEmail, type WelcomeEmailProps } from './templates/welcome.js';
import {
  PasswordChangedEmail,
  type PasswordChangedEmailProps,
} from './templates/password-changed.js';
import {
  TwoFactorEnabledEmail,
  type TwoFactorEnabledEmailProps,
} from './templates/two-factor-enabled.js';
import {
  TwoFactorDisabledEmail,
  type TwoFactorDisabledEmailProps,
} from './templates/two-factor-disabled.js';
import {
  RecoveryCodeUsedEmail,
  type RecoveryCodeUsedEmailProps,
} from './templates/recovery-code-used.js';
import {
  TwoFactorAdminResetEmail,
  type TwoFactorAdminResetEmailProps,
} from './templates/two-factor-admin-reset.js';
import {
  TwoFactorSupportResetContestEmail,
  type TwoFactorSupportResetContestEmailProps,
} from './templates/two-factor-support-reset-contest.js';
import {
  EmailChangeVerificationEmail,
  type EmailChangeVerificationEmailProps,
} from './templates/email-change-verification.js';
import {
  EmailChangeRequestedEmail,
  type EmailChangeRequestedEmailProps,
} from './templates/email-change-requested.js';

export type {
  EmailChangeVerificationEmailProps,
  EmailChangeRequestedEmailProps,
  VerificationEmailProps,
  PasswordResetEmailProps,
  WelcomeEmailProps,
  PasswordChangedEmailProps,
  TwoFactorEnabledEmailProps,
  TwoFactorDisabledEmailProps,
  RecoveryCodeUsedEmailProps,
  TwoFactorAdminResetEmailProps,
  TwoFactorSupportResetContestEmailProps,
};

export async function renderVerificationEmail(props: VerificationEmailProps): Promise<string> {
  return await render(VerificationEmail(props));
}

export async function renderPasswordResetEmail(props: PasswordResetEmailProps): Promise<string> {
  return await render(PasswordResetEmail(props));
}

export async function renderWelcomeEmail(props: WelcomeEmailProps): Promise<string> {
  return await render(WelcomeEmail(props));
}

export async function renderPasswordChangedEmail(
  props: PasswordChangedEmailProps,
): Promise<string> {
  return await render(PasswordChangedEmail(props));
}

export async function renderTwoFactorEnabledEmail(
  props: TwoFactorEnabledEmailProps,
): Promise<string> {
  return await render(TwoFactorEnabledEmail(props));
}

export async function renderTwoFactorDisabledEmail(
  props: TwoFactorDisabledEmailProps,
): Promise<string> {
  return await render(TwoFactorDisabledEmail(props));
}

export async function renderRecoveryCodeUsedEmail(
  props: RecoveryCodeUsedEmailProps,
): Promise<string> {
  return await render(RecoveryCodeUsedEmail(props));
}

export async function renderTwoFactorAdminResetEmail(
  props: TwoFactorAdminResetEmailProps,
): Promise<string> {
  return await render(TwoFactorAdminResetEmail(props));
}

export async function renderTwoFactorSupportResetContestEmail(
  props: TwoFactorSupportResetContestEmailProps,
): Promise<string> {
  return await render(TwoFactorSupportResetContestEmail(props));
}

export async function renderEmailChangeVerificationEmail(
  props: EmailChangeVerificationEmailProps,
): Promise<string> {
  return await render(EmailChangeVerificationEmail(props));
}

export async function renderEmailChangeRequestedEmail(
  props: EmailChangeRequestedEmailProps,
): Promise<string> {
  return await render(EmailChangeRequestedEmail(props));
}
