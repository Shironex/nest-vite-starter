import { Module } from '@nestjs/common';
import { EmailRendererService } from './email-renderer.service';
import { NodemailerEmailProvider } from './providers/nodemailer.provider';
import { EMAIL_PROVIDER } from './providers/email-provider.interface';

/**
 * Shared email plumbing (template renderer + the transport provider),
 * consumed by the background worker (`EmailDeliveryProcessor`, via
 * `EmailDeliveryModule`). The producer (`MailService`) is enqueue-only and no
 * longer touches the transport. Kept as its own module so the transport seam
 * stays independent of the queue wiring.
 *
 * SMTP (nodemailer) is the one transport. To send through a hosted API
 * instead, implement `IEmailProvider` and bind it to `EMAIL_PROVIDER` here.
 */
@Module({
  providers: [
    EmailRendererService,
    NodemailerEmailProvider,
    { provide: EMAIL_PROVIDER, useExisting: NodemailerEmailProvider },
  ],
  exports: [EmailRendererService, EMAIL_PROVIDER],
})
export class EmailTransportModule {}
