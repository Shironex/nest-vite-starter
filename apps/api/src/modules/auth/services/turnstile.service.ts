import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { TURNSTILE_VERIFY_TIMEOUT_MS } from '../../../common/utils/external-timeouts';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Shape of the Cloudflare siteverify response (validated, not trusted). */
const turnstileResponseSchema = z.object({
  success: z.boolean(),
  'error-codes': z.array(z.string()).optional(),
});

/** `AbortSignal.timeout` rejects with a DOMException named `TimeoutError`; match by name so it holds across realms. */
function isTimeoutError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'TimeoutError'
  );
}

@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);
  /** Undefined means the captcha is off (config/env.ts decides when that is allowed). */
  private readonly secretKey: string | undefined;

  constructor(private readonly configService: ConfigService) {
    // An empty secret turns the check off. config/env.ts refuses that in
    // production unless CAPTCHA_DISABLED=true is set explicitly, and refuses
    // Cloudflare's always-pass test secret there too.
    this.secretKey = this.configService.get<string>('TURNSTILE_SECRET_KEY')?.trim() || undefined;
  }

  /**
   * Validate a Cloudflare Turnstile token via the siteverify API. With no
   * secret configured the captcha is off and every token passes. In development
   * the test secret (1x0000000000000000000000000000000AA) always returns success.
   */
  async validate(token: string, remoteIp?: string): Promise<boolean> {
    if (this.secretKey === undefined) return true;
    try {
      const formData = new URLSearchParams();
      formData.append('secret', this.secretKey);
      formData.append('response', token);
      if (remoteIp) {
        formData.append('remoteip', remoteIp);
      }

      const response = await fetch(TURNSTILE_VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData,
        signal: AbortSignal.timeout(TURNSTILE_VERIFY_TIMEOUT_MS),
      });

      if (!response.ok) {
        // A 4xx/5xx from siteverify is an outage or a misconfigured secret, not a
        // failed challenge. Name the status instead of letting the error body
        // surface as a schema parse failure. Fails closed either way.
        this.logger.error('Turnstile verification returned a non-OK status', {
          status: response.status,
        });
        return false;
      }

      const data = turnstileResponseSchema.parse(await response.json());
      if (!data.success) {
        // A genuine challenge rejection: log the Cloudflare error-codes (not the token).
        this.logger.warn('Turnstile challenge rejected', { errorCodes: data['error-codes'] ?? [] });
      }
      return data.success;
    } catch (error) {
      if (isTimeoutError(error)) {
        // Cloudflare accepted the connection (or not) and never answered within
        // the budget: an outage on the verify side, not a failed challenge. Still
        // fails closed, exactly like every other verification error.
        this.logger.error('Turnstile verification timed out', {
          timeoutMs: TURNSTILE_VERIFY_TIMEOUT_MS,
        });
        return false;
      }
      // A throw here means the verify API was unreachable or returned an
      // unexpected shape, distinct from a user failing the challenge.
      this.logger.error(
        'Turnstile verification request failed',
        error instanceof Error ? error : new Error(String(error)),
      );
      return false;
    }
  }
}
