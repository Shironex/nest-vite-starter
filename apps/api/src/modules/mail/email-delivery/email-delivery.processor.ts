import { Inject } from '@nestjs/common';
import { Processor } from '@nestjs/bullmq';
import { UnrecoverableError } from 'bullmq';
import type { Job } from 'bullmq';
import { TracedWorkerHost } from '../../../common/queue/traced-worker.host';
import { parseJobData } from '../../../common/queue/job-payload';
import { EmailRendererService } from '../email-renderer.service';
import { EMAIL_PROVIDER, type IEmailProvider } from '../providers/email-provider.interface';
import {
  EMAIL_DELIVERY_DEFAULTS,
  EMAIL_DELIVERY_JOB_NAMES,
  EMAIL_DELIVERY_QUEUE_NAME,
} from './email-delivery.constants';
import {
  sendPasswordChangedJobSchema,
  sendPasswordResetJobSchema,
  sendVerificationJobSchema,
  sendWelcomeJobSchema,
  sendTwoFactorEnabledJobSchema,
  sendTwoFactorDisabledJobSchema,
  sendRecoveryCodeUsedJobSchema,
  sendTwoFactorAdminResetJobSchema,
  sendTwoFactorSupportResetContestJobSchema,
  sendEmailChangeVerificationJobSchema,
  sendEmailChangeRequestedJobSchema,
} from './email-delivery.schemas';

/**
 * Consumer for ALL app email (critical auth mail rides the queue too, at the
 * highest priority; see email-delivery.constants.ts). Renders the matching
 * `@repo/email` template and sends through the configured `IEmailProvider`.
 * Throws on send failure so BullMQ retries per `EMAIL_DELIVERY_DEFAULTS`
 * (5 attempts, exponential backoff); after exhaustion the job is retained in
 * the failed set (the DLQ, bounded by `removeOnFail`). Tracing/ALS re-entry
 * and failure logging come from `TracedWorkerHost`.
 */
@Processor(EMAIL_DELIVERY_QUEUE_NAME, { concurrency: EMAIL_DELIVERY_DEFAULTS.concurrency })
export class EmailDeliveryProcessor extends TracedWorkerHost {
  constructor(
    private readonly renderer: EmailRendererService,
    @Inject(EMAIL_PROVIDER) private readonly provider: IEmailProvider,
  ) {
    super();
  }

  async processJob(job: Job): Promise<void> {
    await this.deliver(job);
  }

  // Each case runtime-validates the Redis-persisted payload (parseJobData
  // throws a non-retryable UnrecoverableError straight to the DLQ on
  // mismatch) and works from the PARSED data, so the withJobContext `_ctx` /
  // `_traceparent` siblings are stripped and never reach render input or the
  // outgoing email.
  private async deliver(job: Job): Promise<void> {
    switch (job.name) {
      case EMAIL_DELIVERY_JOB_NAMES.SEND_VERIFICATION: {
        const { to, props } = parseJobData(sendVerificationJobSchema, job);
        const html = await this.renderer.renderVerificationEmail(props);
        await this.provider.send({ to, subject: 'Verify your email address', html });
        return;
      }
      case EMAIL_DELIVERY_JOB_NAMES.SEND_PASSWORD_RESET: {
        const { to, props } = parseJobData(sendPasswordResetJobSchema, job);
        const html = await this.renderer.renderPasswordResetEmail(props);
        await this.provider.send({ to, subject: 'Reset your password', html });
        return;
      }
      case EMAIL_DELIVERY_JOB_NAMES.SEND_WELCOME: {
        const { to, props } = parseJobData(sendWelcomeJobSchema, job);
        const html = await this.renderer.renderWelcomeEmail(props);
        await this.provider.send({ to, subject: `Welcome to ${props.appName}!`, html });
        return;
      }
      case EMAIL_DELIVERY_JOB_NAMES.SEND_PASSWORD_CHANGED: {
        const { to, props } = parseJobData(sendPasswordChangedJobSchema, job);
        const html = await this.renderer.renderPasswordChangedEmail(props);
        await this.provider.send({ to, subject: 'Your password has been changed', html });
        return;
      }
      case EMAIL_DELIVERY_JOB_NAMES.SEND_TWO_FACTOR_ENABLED: {
        const { to, props } = parseJobData(sendTwoFactorEnabledJobSchema, job);
        const html = await this.renderer.renderTwoFactorEnabledEmail(props);
        await this.provider.send({ to, subject: 'Two-factor authentication turned on', html });
        return;
      }
      case EMAIL_DELIVERY_JOB_NAMES.SEND_TWO_FACTOR_DISABLED: {
        const { to, props } = parseJobData(sendTwoFactorDisabledJobSchema, job);
        const html = await this.renderer.renderTwoFactorDisabledEmail(props);
        await this.provider.send({ to, subject: 'Two-factor authentication turned off', html });
        return;
      }
      case EMAIL_DELIVERY_JOB_NAMES.SEND_RECOVERY_CODE_USED: {
        const { to, props } = parseJobData(sendRecoveryCodeUsedJobSchema, job);
        const html = await this.renderer.renderRecoveryCodeUsedEmail(props);
        await this.provider.send({ to, subject: 'A recovery code was used to sign in', html });
        return;
      }
      case EMAIL_DELIVERY_JOB_NAMES.SEND_TWO_FACTOR_ADMIN_RESET: {
        const { to, props } = parseJobData(sendTwoFactorAdminResetJobSchema, job);
        const html = await this.renderer.renderTwoFactorAdminResetEmail(props);
        await this.provider.send({
          to,
          subject: 'Your two-factor authentication was reset',
          html,
        });
        return;
      }
      case EMAIL_DELIVERY_JOB_NAMES.SEND_TWO_FACTOR_SUPPORT_RESET_CONTEST: {
        const { to, props } = parseJobData(sendTwoFactorSupportResetContestJobSchema, job);
        const html = await this.renderer.renderTwoFactorSupportResetContestEmail(props);
        await this.provider.send({
          to,
          subject: 'Confirm your two-factor authentication reset request',
          html,
        });
        return;
      }
      case EMAIL_DELIVERY_JOB_NAMES.SEND_EMAIL_CHANGE_VERIFICATION: {
        const { to, props } = parseJobData(sendEmailChangeVerificationJobSchema, job);
        const html = await this.renderer.renderEmailChangeVerificationEmail(props);
        await this.provider.send({ to, subject: 'Confirm your new email address', html });
        return;
      }
      case EMAIL_DELIVERY_JOB_NAMES.SEND_EMAIL_CHANGE_REQUESTED: {
        const { to, props } = parseJobData(sendEmailChangeRequestedJobSchema, job);
        const html = await this.renderer.renderEmailChangeRequestedEmail(props);
        await this.provider.send({
          to,
          subject: 'An email address change was requested',
          html,
        });
        return;
      }
      default:
        // Retrying an unknown name can never succeed: fail straight to the DLQ.
        throw new UnrecoverableError(`Unknown email-delivery job name: ${job.name}`);
    }
  }
}
