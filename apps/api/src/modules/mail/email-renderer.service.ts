import { Injectable } from '@nestjs/common';
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
} from '@repo/email' with { 'resolution-mode': 'import' };
import { esmImport } from '../../common/utils/esm-import';

interface IEmailRenderModule {
  renderVerificationEmail(props: VerificationEmailProps): Promise<string>;
  renderPasswordResetEmail(props: PasswordResetEmailProps): Promise<string>;
  renderWelcomeEmail(props: WelcomeEmailProps): Promise<string>;
  renderPasswordChangedEmail(props: PasswordChangedEmailProps): Promise<string>;
  renderTwoFactorEnabledEmail(props: TwoFactorEnabledEmailProps): Promise<string>;
  renderTwoFactorDisabledEmail(props: TwoFactorDisabledEmailProps): Promise<string>;
  renderRecoveryCodeUsedEmail(props: RecoveryCodeUsedEmailProps): Promise<string>;
  renderTwoFactorAdminResetEmail(props: TwoFactorAdminResetEmailProps): Promise<string>;
  renderTwoFactorPolicyAnnouncementEmail(
    props: TwoFactorPolicyAnnouncementEmailProps,
  ): Promise<string>;
  renderTwoFactorEnforcementReminderEmail(
    props: TwoFactorEnforcementReminderEmailProps,
  ): Promise<string>;
  renderTwoFactorSupportResetContestEmail(
    props: TwoFactorSupportResetContestEmailProps,
  ): Promise<string>;
  renderEmailChangeVerificationEmail(props: EmailChangeVerificationEmailProps): Promise<string>;
  renderEmailChangeRequestedEmail(props: EmailChangeRequestedEmailProps): Promise<string>;
  renderStaffInviteEmail(props: StaffInviteEmailProps): Promise<string>;
  renderStaffInviteJoinAndCloseEmail(props: StaffInviteJoinAndCloseEmailProps): Promise<string>;
}

/**
 * Single home for rendering `@repo/email` react-email templates to HTML.
 *
 * `@repo/email` is ESM-only (react-email) and apps/api compiles to CJS, so it
 * must be loaded through the `esmImport` workaround or the render call throws
 * `ERR_REQUIRE_ESM`. Centralizing that here means the workaround exists in
 * exactly one place; all rendering now happens in the background worker
 * (`EmailDeliveryProcessor`), the sole consumer.
 */
@Injectable()
export class EmailRendererService {
  private modulePromise?: Promise<IEmailRenderModule>;

  private getModule(): Promise<IEmailRenderModule> {
    // Cache the dynamic import so the ESM module is evaluated once per process.
    this.modulePromise ??= esmImport('@repo/email') as Promise<IEmailRenderModule>;
    return this.modulePromise;
  }

  async renderVerificationEmail(props: VerificationEmailProps): Promise<string> {
    return (await this.getModule()).renderVerificationEmail(props);
  }

  async renderPasswordResetEmail(props: PasswordResetEmailProps): Promise<string> {
    return (await this.getModule()).renderPasswordResetEmail(props);
  }

  async renderWelcomeEmail(props: WelcomeEmailProps): Promise<string> {
    return (await this.getModule()).renderWelcomeEmail(props);
  }

  async renderPasswordChangedEmail(props: PasswordChangedEmailProps): Promise<string> {
    return (await this.getModule()).renderPasswordChangedEmail(props);
  }

  async renderTwoFactorEnabledEmail(props: TwoFactorEnabledEmailProps): Promise<string> {
    return (await this.getModule()).renderTwoFactorEnabledEmail(props);
  }

  async renderTwoFactorDisabledEmail(props: TwoFactorDisabledEmailProps): Promise<string> {
    return (await this.getModule()).renderTwoFactorDisabledEmail(props);
  }

  async renderRecoveryCodeUsedEmail(props: RecoveryCodeUsedEmailProps): Promise<string> {
    return (await this.getModule()).renderRecoveryCodeUsedEmail(props);
  }

  async renderTwoFactorAdminResetEmail(props: TwoFactorAdminResetEmailProps): Promise<string> {
    return (await this.getModule()).renderTwoFactorAdminResetEmail(props);
  }

  async renderTwoFactorPolicyAnnouncementEmail(
    props: TwoFactorPolicyAnnouncementEmailProps,
  ): Promise<string> {
    return (await this.getModule()).renderTwoFactorPolicyAnnouncementEmail(props);
  }

  async renderTwoFactorEnforcementReminderEmail(
    props: TwoFactorEnforcementReminderEmailProps,
  ): Promise<string> {
    return (await this.getModule()).renderTwoFactorEnforcementReminderEmail(props);
  }

  async renderTwoFactorSupportResetContestEmail(
    props: TwoFactorSupportResetContestEmailProps,
  ): Promise<string> {
    return (await this.getModule()).renderTwoFactorSupportResetContestEmail(props);
  }

  async renderEmailChangeVerificationEmail(
    props: EmailChangeVerificationEmailProps,
  ): Promise<string> {
    return (await this.getModule()).renderEmailChangeVerificationEmail(props);
  }

  async renderEmailChangeRequestedEmail(props: EmailChangeRequestedEmailProps): Promise<string> {
    return (await this.getModule()).renderEmailChangeRequestedEmail(props);
  }

  async renderStaffInviteEmail(props: StaffInviteEmailProps): Promise<string> {
    return (await this.getModule()).renderStaffInviteEmail(props);
  }

  async renderStaffInviteJoinAndCloseEmail(
    props: StaffInviteJoinAndCloseEmailProps,
  ): Promise<string> {
    return (await this.getModule()).renderStaffInviteJoinAndCloseEmail(props);
  }
}
