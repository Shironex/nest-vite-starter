import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import {
  SMTP_CONNECTION_TIMEOUT_MS,
  SMTP_GREETING_TIMEOUT_MS,
  SMTP_SOCKET_TIMEOUT_MS,
} from '../../../common/utils/external-timeouts';
import type { IEmailMessage, IEmailProvider } from './email-provider.interface';

/**
 * Default email transport: nodemailer over SMTP. In dev this points at Mailpit
 * (no auth); in prod it carries real SMTP credentials. This is the only place
 * that constructs the transporter, moved out of `MailService` so the send
 * mechanism lives behind the `IEmailProvider` seam.
 */
@Injectable()
export class NodemailerEmailProvider implements IEmailProvider {
  private readonly logger = new Logger(NodemailerEmailProvider.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.getOrThrow<string>('SMTP_HOST');
    const port = this.configService.getOrThrow<number>('SMTP_PORT');
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');

    // If SMTP_USER/SMTP_PASS are empty, create transport without auth (Mailpit).
    const auth = user && pass ? { user, pass } : undefined;

    // Explicit budgets: a stalled relay would otherwise pin one of the delivery
    // worker's slots for nodemailer's 2 min connect / 10 min idle defaults.
    this.transporter = nodemailer.createTransport({
      host,
      port,
      auth,
      connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
      socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
    });
    this.from = this.configService.getOrThrow<string>('SMTP_FROM');
  }

  async send(message: IEmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: message.from ?? this.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
    });
    // Recipient address is deliberately not logged (message strings are not
    // redacted by the logger). Subject rides the structured data channel,
    // which is redacted.
    this.logger.log('Email sent via SMTP', { subject: message.subject });
  }
}
