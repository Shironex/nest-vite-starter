import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvariantError } from '../../../common/errors/invariant-error';
import type { IEmailMessage, IEmailProvider } from './email-provider.interface';

/**
 * Resend transport seam (STUB). Proves the `IEmailProvider` abstraction is
 * swappable without touching producers/processor; the actual HTTP send is left
 * unimplemented on purpose for this phase.
 *
 * The DI factory in `MailModule` instantiates BOTH providers and picks one by
 * `EMAIL_PROVIDER`, so this constructor MUST stay inert (no `getOrThrow`, no
 * network) or boot would fail whenever `EMAIL_PROVIDER=smtp` and no Resend key
 * is set. The hard failure belongs in `send()`, reached only when this
 * provider is actually selected.
 *
 * To finish wiring later: `pnpm --filter @repo/api add resend`, then in `send`:
 *   const resend = new Resend(this.apiKey);
 *   await resend.emails.send({ from: message.from ?? this.from, to: message.to,
 *     subject: message.subject, html: message.html });
 */
@Injectable()
export class ResendEmailProvider implements IEmailProvider {
  private readonly logger = new Logger(ResendEmailProvider.name);
  private readonly apiKey: string | undefined;

  constructor(private readonly configService: ConfigService) {
    // Read but do not require: this provider is constructed even when SMTP is
    // the active transport.
    this.apiKey = this.configService.get<string>('RESEND_API_KEY') || undefined;
  }

  async send(_message: IEmailMessage): Promise<void> {
    this.logger.error(
      'ResendEmailProvider.send called but the Resend transport is not implemented',
    );
    throw new InvariantError(
      'Resend email transport is a stub. Set EMAIL_PROVIDER=smtp or implement ResendEmailProvider.send.',
    );
  }
}
