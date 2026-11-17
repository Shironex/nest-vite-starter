/**
 * Transport-agnostic email seam. The email-delivery processor sends every mail
 * class through an `IEmailProvider`, so swapping nodemailer/SMTP for a hosted
 * API is a one-line DI change in `EmailTransportModule` and nothing in the
 * producer or processor moves.
 */
export interface IEmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  /** Overrides the provider's configured default `from`. */
  readonly from?: string;
}

export interface IEmailProvider {
  send(message: IEmailMessage): Promise<void>;
}

/** DI token for the active `IEmailProvider`. */
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
