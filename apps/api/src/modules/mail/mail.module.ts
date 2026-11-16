import { Module } from '@nestjs/common';
import { EmailDeliveryModule } from './email-delivery/email-delivery.module';
import { MailService } from './mail.service';

/**
 * Producer side of email. Imports only the email-delivery queue: `MailService`
 * is enqueue-only (rendering and transport live behind the processor in
 * `EmailDeliveryModule`/`EmailTransportModule`) and keeps the same public
 * surface auth depends on.
 */
@Module({
  imports: [EmailDeliveryModule],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
