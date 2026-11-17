import type { ConfigService } from '@nestjs/config';

const sendMailMock = jest.fn();
const createTransportMock = jest.fn((..._args: unknown[]) => ({ sendMail: sendMailMock }));

jest.mock('nodemailer', () => ({
  createTransport: (...args: unknown[]) => createTransportMock(...args),
}));

import {
  SMTP_CONNECTION_TIMEOUT_MS,
  SMTP_GREETING_TIMEOUT_MS,
  SMTP_SOCKET_TIMEOUT_MS,
} from '../../../common/utils/external-timeouts';
import { NodemailerEmailProvider } from './nodemailer.provider';

const buildConfig = (
  overrides: Record<string, string | number | boolean | undefined> = {},
): ConfigService => {
  const values: Record<string, string | number | boolean | undefined> = {
    SMTP_HOST: 'mailpit',
    SMTP_PORT: 1025,
    SMTP_USER: 'user',
    SMTP_PASS: 'pass',
    MAIL_FROM: 'from@example.com',
    ...overrides,
  };
  return {
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => {
      const v = values[key];
      if (v === undefined) throw new Error(`Missing config: ${key}`);
      return v;
    }),
  } as unknown as ConfigService;
};

describe('NodemailerEmailProvider', () => {
  beforeEach(() => {
    sendMailMock.mockReset();
    sendMailMock.mockResolvedValue({});
    createTransportMock.mockClear();
  });

  // These two assertions moved here from the old MailService spec when the
  // transporter construction moved into this provider.
  it('builds transporter with auth when SMTP_USER and SMTP_PASS are set', () => {
    new NodemailerEmailProvider(buildConfig());
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'mailpit',
        port: 1025,
        auth: { user: 'user', pass: 'pass' },
      }),
    );
  });

  it('builds transporter with auth: undefined when SMTP_USER/PASS are empty (Mailpit dev)', () => {
    new NodemailerEmailProvider(buildConfig({ SMTP_USER: '', SMTP_PASS: '' }));
    expect(createTransportMock).toHaveBeenCalledWith(expect.objectContaining({ auth: undefined }));
  });

  it('requires STARTTLS when SMTP_REQUIRE_TLS is true', () => {
    new NodemailerEmailProvider(buildConfig({ SMTP_REQUIRE_TLS: true }));
    expect(createTransportMock).toHaveBeenCalledWith(expect.objectContaining({ requireTLS: true }));
  });

  it('leaves STARTTLS opportunistic when SMTP_REQUIRE_TLS is false (dev Mailpit)', () => {
    new NodemailerEmailProvider(buildConfig({ SMTP_REQUIRE_TLS: false }));
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ requireTLS: false }),
    );
  });

  it('builds the transporter with explicit connection, greeting and socket timeouts', () => {
    new NodemailerEmailProvider(buildConfig());
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
        greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
        socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
      }),
    );
  });

  it('send() forwards to/subject/html and defaults from to MAIL_FROM', async () => {
    const provider = new NodemailerEmailProvider(buildConfig());
    await provider.send({ to: 'jane@example.com', subject: 'Hi', html: '<p/>' });
    expect(sendMailMock).toHaveBeenCalledWith({
      from: 'from@example.com',
      to: 'jane@example.com',
      subject: 'Hi',
      html: '<p/>',
    });
  });

  it('send() honors a per-message from override', async () => {
    const provider = new NodemailerEmailProvider(buildConfig());
    await provider.send({ to: 'a@b.c', subject: 'Hi', html: '<p/>', from: 'override@x.com' });
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({ from: 'override@x.com' }));
  });
});
