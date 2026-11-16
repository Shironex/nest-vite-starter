import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailRendererService } from './email-renderer.service';
import { NodemailerEmailProvider } from './providers/nodemailer.provider';
import { ResendEmailProvider } from './providers/resend.provider';
import { EMAIL_PROVIDER, type IEmailProvider } from './providers/email-provider.interface';

/**
 * Shared email plumbing (template renderer + the swappable transport provider),
 * consumed by the background worker (`EmailDeliveryProcessor`, via
 * `EmailDeliveryModule`). The producer (`MailService`) is enqueue-only and no
 * longer touches the transport. Kept as its own module so the transport seam
 * stays independent of the queue wiring.
 *
 * `EMAIL_PROVIDER` is chosen at boot by the `EMAIL_PROVIDER` env var; both
 * concrete providers are instantiated (their constructors are inert) and the
 * factory returns the selected one.
 */
@Module({
  providers: [
    EmailRendererService,
    NodemailerEmailProvider,
    ResendEmailProvider,
    {
      provide: EMAIL_PROVIDER,
      inject: [ConfigService, NodemailerEmailProvider, ResendEmailProvider],
      useFactory: (
        config: ConfigService,
        smtp: NodemailerEmailProvider,
        resend: ResendEmailProvider,
      ): IEmailProvider => (config.get<string>('EMAIL_PROVIDER') === 'resend' ? resend : smtp),
    },
  ],
  exports: [EmailRendererService, EMAIL_PROVIDER],
})
export class EmailTransportModule {}
