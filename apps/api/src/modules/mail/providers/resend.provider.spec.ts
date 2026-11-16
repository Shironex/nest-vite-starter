import type { ConfigService } from '@nestjs/config';
import { InvariantError } from '../../../common/errors/invariant-error';
import { ResendEmailProvider } from './resend.provider';

const buildConfig = (resendKey?: string): ConfigService =>
  ({
    get: jest.fn((key: string) => (key === 'RESEND_API_KEY' ? resendKey : undefined)),
  }) as unknown as ConfigService;

describe('ResendEmailProvider (stub)', () => {
  it('constructs inertly even without a RESEND_API_KEY (it is built even when SMTP is active)', () => {
    expect(() => new ResendEmailProvider(buildConfig(undefined))).not.toThrow();
    expect(() => new ResendEmailProvider(buildConfig('re_123'))).not.toThrow();
  });

  it('throws an InvariantError on send', async () => {
    const provider = new ResendEmailProvider(buildConfig('re_123'));
    await expect(
      provider.send({ to: 'a@b.c', subject: 'Hi', html: '<p/>' }),
    ).rejects.toBeInstanceOf(InvariantError);
  });
});
