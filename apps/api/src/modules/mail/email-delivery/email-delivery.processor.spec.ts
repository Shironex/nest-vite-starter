import { UnrecoverableError } from 'bullmq';
import type { Job } from 'bullmq';
import { EmailDeliveryProcessor } from './email-delivery.processor';
import { EMAIL_DELIVERY_JOB_NAMES } from './email-delivery.constants';
import type { EmailRendererService } from '../email-renderer.service';
import type { IEmailProvider } from '../providers/email-provider.interface';

const makeJob = (
  name: string,
  data: unknown,
  attempts: { made?: number; max?: number } = {},
): Job =>
  ({
    name,
    data,
    attemptsMade: attempts.made ?? 0,
    opts: { attempts: attempts.max ?? 5 },
  }) as Job;

describe('EmailDeliveryProcessor', () => {
  let renderer: jest.Mocked<
    Pick<
      EmailRendererService,
      | 'renderVerificationEmail'
      | 'renderPasswordResetEmail'
      | 'renderWelcomeEmail'
      | 'renderPasswordChangedEmail'
      | 'renderEmailChangeVerificationEmail'
      | 'renderEmailChangeRequestedEmail'
    >
  >;
  let provider: jest.Mocked<IEmailProvider>;
  let processor: EmailDeliveryProcessor;

  beforeEach(() => {
    renderer = {
      renderVerificationEmail: jest.fn().mockResolvedValue('<verif/>'),
      renderPasswordResetEmail: jest.fn().mockResolvedValue('<reset/>'),
      renderWelcomeEmail: jest.fn().mockResolvedValue('<welcome/>'),
      renderPasswordChangedEmail: jest.fn().mockResolvedValue('<changed/>'),
      renderEmailChangeVerificationEmail: jest.fn().mockResolvedValue('<email-change-verify/>'),
      renderEmailChangeRequestedEmail: jest.fn().mockResolvedValue('<email-change-tripwire/>'),
    };
    provider = { send: jest.fn().mockResolvedValue(undefined) };
    processor = new EmailDeliveryProcessor(renderer as unknown as EmailRendererService, provider);
  });

  it('renders the verification template and sends (critical class rides the queue)', async () => {
    await processor.processJob(
      makeJob(EMAIL_DELIVERY_JOB_NAMES.SEND_VERIFICATION, {
        to: 'jane@example.com',
        props: { verificationUrl: 'https://verify', appName: 'SaaS Starter' },
        _ctx: { requestId: 'r1' },
      }),
    );

    expect(renderer.renderVerificationEmail).toHaveBeenCalledWith({
      verificationUrl: 'https://verify',
      appName: 'SaaS Starter',
    });
    expect(provider.send).toHaveBeenCalledWith({
      to: 'jane@example.com',
      subject: 'Verify your email address',
      html: '<verif/>',
    });
  });

  it('renders the password-reset template with ipAddress and sends', async () => {
    await processor.processJob(
      makeJob(EMAIL_DELIVERY_JOB_NAMES.SEND_PASSWORD_RESET, {
        to: 'a@b.c',
        props: { resetUrl: 'https://reset', ipAddress: '203.0.113.5', appName: 'SaaS Starter' },
      }),
    );

    expect(renderer.renderPasswordResetEmail).toHaveBeenCalledWith({
      resetUrl: 'https://reset',
      ipAddress: '203.0.113.5',
      appName: 'SaaS Starter',
    });
    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@b.c', subject: 'Reset your password' }),
    );
  });

  it('renders the welcome template and sends once, ignoring keys the schema does not name', async () => {
    await processor.processJob(
      makeJob(EMAIL_DELIVERY_JOB_NAMES.SEND_WELCOME, {
        to: 'jane@example.com',
        props: { loginUrl: 'https://login', appName: 'SaaS Starter' },
        extra: { requestId: 'r1' },
      }),
    );

    expect(renderer.renderWelcomeEmail).toHaveBeenCalledWith({
      loginUrl: 'https://login',
      appName: 'SaaS Starter',
    });
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(provider.send).toHaveBeenCalledWith({
      to: 'jane@example.com',
      subject: 'Welcome to SaaS Starter!',
      html: '<welcome/>',
    });
  });

  it('renders the password-changed template and sends', async () => {
    await processor.processJob(
      makeJob(EMAIL_DELIVERY_JOB_NAMES.SEND_PASSWORD_CHANGED, {
        to: 'a@b.c',
        props: { appName: 'SaaS Starter' },
      }),
    );

    expect(renderer.renderPasswordChangedEmail).toHaveBeenCalledWith({ appName: 'SaaS Starter' });
    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@b.c', subject: 'Your password has been changed' }),
    );
  });

  it('renders the email-change verification link for the new address and sends', async () => {
    await processor.processJob(
      makeJob(EMAIL_DELIVERY_JOB_NAMES.SEND_EMAIL_CHANGE_VERIFICATION, {
        to: 'new@example.com',
        props: { confirmUrl: 'https://x/confirm', appName: 'SaaS Starter', expiresIn: '1 hour' },
        _ctx: { requestId: 'r1' },
      }),
    );

    expect(renderer.renderEmailChangeVerificationEmail).toHaveBeenCalledWith({
      confirmUrl: 'https://x/confirm',
      appName: 'SaaS Starter',
      expiresIn: '1 hour',
    });
    expect(provider.send).toHaveBeenCalledWith({
      to: 'new@example.com',
      subject: 'Confirm your new email address',
      html: '<email-change-verify/>',
    });
  });

  it('renders the email-change tripwire for the old address and sends', async () => {
    await processor.processJob(
      makeJob(EMAIL_DELIVERY_JOB_NAMES.SEND_EMAIL_CHANGE_REQUESTED, {
        to: 'old@example.com',
        props: {
          appName: 'SaaS Starter',
          newEmail: 'new@example.com',
          settingsUrl: 'https://x/settings',
        },
        _ctx: { requestId: 'r1' },
      }),
    );

    expect(renderer.renderEmailChangeRequestedEmail).toHaveBeenCalledWith({
      appName: 'SaaS Starter',
      newEmail: 'new@example.com',
      settingsUrl: 'https://x/settings',
    });
    expect(provider.send).toHaveBeenCalledWith({
      to: 'old@example.com',
      subject: 'An email address change was requested',
      html: '<email-change-tripwire/>',
    });
  });

  it('rethrows a send failure so BullMQ retries', async () => {
    provider.send.mockRejectedValue(new Error('smtp down'));
    await expect(
      processor.processJob(
        makeJob(
          EMAIL_DELIVERY_JOB_NAMES.SEND_WELCOME,
          { to: 'a@b.c', props: { loginUrl: 'u', appName: 'SaaS Starter' } },
          { made: 0, max: 5 },
        ),
      ),
    ).rejects.toThrow('smtp down');
  });

  it('throws a non-retryable UnrecoverableError on an unknown job name', async () => {
    const failure = processor.processJob(makeJob('send-unknown', {}));
    await expect(failure).rejects.toThrow(/Unknown email-delivery job name/);
    await expect(failure).rejects.toBeInstanceOf(UnrecoverableError);
  });

  describe('runtime payload validation (Redis round-trip is untrusted)', () => {
    it('fails a malformed payload straight to the DLQ with UnrecoverableError, no render/send', async () => {
      const failure = processor.processJob(
        makeJob(EMAIL_DELIVERY_JOB_NAMES.SEND_VERIFICATION, {
          to: 'a@b.c',
          // props.verificationUrl missing entirely.
          props: { appName: 'SaaS Starter' },
        }),
      );
      await expect(failure).rejects.toBeInstanceOf(UnrecoverableError);
      await expect(failure).rejects.toThrow(/Invalid .*send-verification payload/);
      expect(renderer.renderVerificationEmail).not.toHaveBeenCalled();
      expect(provider.send).not.toHaveBeenCalled();
    });

    it('does not leak payload values into the validation error message', async () => {
      const failure = processor.processJob(
        makeJob(EMAIL_DELIVERY_JOB_NAMES.SEND_WELCOME, {
          to: 'secret-recipient@example.com',
          props: { loginUrl: 42, appName: 'SaaS Starter' },
        }),
      );
      const err = await failure.then(
        () => null,
        (e: unknown) => e as Error,
      );
      expect(err).toBeInstanceOf(UnrecoverableError);
      expect(err?.message).not.toContain('secret-recipient');
      expect(err?.message).toContain('props.loginUrl');
    });

    it('treats a payload mismatch as final (UnrecoverableError) even on attempt 1', async () => {
      await expect(
        processor.processJob(
          makeJob(EMAIL_DELIVERY_JOB_NAMES.SEND_PASSWORD_CHANGED, { to: 'a@b.c' }, { made: 0 }),
        ),
      ).rejects.toBeInstanceOf(UnrecoverableError);
    });

    it('strips keys the schema does not name before rendering', async () => {
      await processor.processJob(
        makeJob(EMAIL_DELIVERY_JOB_NAMES.SEND_PASSWORD_CHANGED, {
          to: 'a@b.c',
          props: { appName: 'SaaS Starter' },
          extra: { requestId: 'r1' },
        }),
      );
      expect(renderer.renderPasswordChangedEmail).toHaveBeenCalledWith({ appName: 'SaaS Starter' });
      expect(provider.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'a@b.c', subject: 'Your password has been changed' }),
      );
    });
  });
});
