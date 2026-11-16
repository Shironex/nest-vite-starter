import type { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { MailService } from './mail.service';
import { requestContext } from '../../common/context/request-context';
import { sha256Hex } from '../../common/utils/crypto';
import {
  EMAIL_DELIVERY_JOB_NAMES,
  EMAIL_DELIVERY_NON_CRITICAL_PRIORITY,
} from './email-delivery/email-delivery.constants';

const buildConfig = (appName = 'TestApp'): ConfigService =>
  ({
    getOrThrow: jest.fn((key: string) => {
      if (key === 'APP_NAME') return appName;
      if (key === 'APP_URL') return 'https://app.example';
      return undefined;
    }),
  }) as unknown as ConfigService;

describe('MailService', () => {
  let queue: jest.Mocked<Pick<Queue, 'add'>>;
  let service: MailService;

  beforeEach(() => {
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    service = new MailService(buildConfig(), queue as unknown as Queue);
  });

  describe('queued critical auth mail (highest-priority class)', () => {
    it('sendVerificationEmail enqueues send-verification without a priority option', async () => {
      await service.sendVerificationEmail('jane@example.com', 'https://verify');
      expect(queue.add).toHaveBeenCalledWith(
        EMAIL_DELIVERY_JOB_NAMES.SEND_VERIFICATION,
        expect.objectContaining({
          to: 'jane@example.com',
          // Expiry prose is derived from the shared VERIFICATION_TOKEN_TTL_MS.
          props: { verificationUrl: 'https://verify', appName: 'TestApp', expiresIn: '24 hours' },
        }),
        expect.any(Object),
      );
      // Critical mail deliberately passes NO priority: BullMQ drains the plain
      // wait list before the prioritized set, so unprioritized is the highest
      // priority class.
      const opts = queue.add.mock.calls[0]![2];
      expect(opts?.priority).toBeUndefined();
      // Deterministic dedupe id: sha256 of the token-bearing URL.
      expect(opts?.jobId).toBe(`verification-${sha256Hex('https://verify')}`);
    });

    it('derives the same jobId for the same token URL and a new one per resend (new token)', async () => {
      await service.sendVerificationEmail('a@b.c', 'https://verify?token=t1');
      await service.sendVerificationEmail('a@b.c', 'https://verify?token=t1');
      await service.sendVerificationEmail('a@b.c', 'https://verify?token=t2');
      const ids = queue.add.mock.calls.map((call) => call[2]?.jobId);
      expect(ids[0]).toBe(ids[1]);
      expect(ids[2]).not.toBe(ids[0]);
    });

    it('sendEmailChangeVerificationEmail enqueues the confirm link without a priority option', async () => {
      await service.sendEmailChangeVerificationEmail('new@example.com', 'https://confirm?token=t');
      expect(queue.add).toHaveBeenCalledWith(
        EMAIL_DELIVERY_JOB_NAMES.SEND_EMAIL_CHANGE_VERIFICATION,
        expect.objectContaining({
          to: 'new@example.com',
          // Expiry prose is derived from the shared EMAIL_CHANGE_TOKEN_TTL_MS.
          props: {
            confirmUrl: 'https://confirm?token=t',
            appName: 'TestApp',
            expiresIn: '1 hour',
          },
        }),
        expect.any(Object),
      );
      const opts = queue.add.mock.calls[0]![2];
      // Critical class: no priority option, sha256-of-URL dedupe id.
      expect(opts?.priority).toBeUndefined();
      expect(opts?.jobId).toBe(`email-change-verification-${sha256Hex('https://confirm?token=t')}`);
    });

    it('sendPasswordResetEmail enqueues send-password-reset with ipAddress in props', async () => {
      await service.sendPasswordResetEmail('a@b.c', 'https://reset', '203.0.113.5');
      expect(queue.add).toHaveBeenCalledWith(
        EMAIL_DELIVERY_JOB_NAMES.SEND_PASSWORD_RESET,
        expect.objectContaining({
          to: 'a@b.c',
          // Expiry prose is derived from the shared PASSWORD_RESET_TOKEN_TTL_MS.
          props: {
            resetUrl: 'https://reset',
            ipAddress: '203.0.113.5',
            appName: 'TestApp',
            expiresIn: '1 hour',
          },
        }),
        expect.any(Object),
      );
      const opts = queue.add.mock.calls[0]![2];
      expect(opts?.priority).toBeUndefined();
      expect(opts?.jobId).toBe(`password-reset-${sha256Hex('https://reset')}`);
    });

    it('rethrows an enqueue failure on the critical path (callers decide tolerance)', async () => {
      queue.add.mockRejectedValue(new Error('redis down'));
      await expect(service.sendVerificationEmail('a@b.c', 'https://x')).rejects.toThrow(
        'redis down',
      );
    });

    it('rethrows when a critical enqueue throws', async () => {
      queue.add.mockRejectedValue(new Error('redis down'));

      await expect(service.sendVerificationEmail('a@b.c', 'https://x')).rejects.toThrow();

      await expect(
        service.sendPasswordResetEmail('a@b.c', 'https://r', '1.2.3.4'),
      ).rejects.toThrow();
    });
  });

  describe('queued non-critical mail (lower-priority class)', () => {
    it('sendWelcomeEmail enqueues send-welcome at the non-critical priority with welcome-{userId} dedupe', async () => {
      await service.sendWelcomeEmail('a@b.c', 'https://login', 'u-1');
      expect(queue.add).toHaveBeenCalledWith(
        EMAIL_DELIVERY_JOB_NAMES.SEND_WELCOME,
        expect.objectContaining({
          to: 'a@b.c',
          props: { loginUrl: 'https://login', appName: 'TestApp' },
        }),
        expect.objectContaining({
          priority: EMAIL_DELIVERY_NON_CRITICAL_PRIORITY,
          jobId: 'welcome-u-1',
        }),
      );
    });

    it('sendPasswordChangedEmail enqueues send-password-changed at the non-critical priority', async () => {
      await service.sendPasswordChangedEmail('a@b.c');
      expect(queue.add).toHaveBeenCalledWith(
        EMAIL_DELIVERY_JOB_NAMES.SEND_PASSWORD_CHANGED,
        expect.objectContaining({ to: 'a@b.c', props: { appName: 'TestApp' } }),
        expect.objectContaining({ priority: EMAIL_DELIVERY_NON_CRITICAL_PRIORITY }),
      );
      // Outside a request context there is no stable dedupe key: no jobId.
      expect(queue.add.mock.calls[0]![2]?.jobId).toBeUndefined();
    });

    it('sendPasswordChangedEmail dedupes per originating request (hashed dedupeNonce jobId)', async () => {
      await requestContext.run({ requestId: 'req-1', dedupeNonce: 'nonce-1' }, () =>
        service.sendPasswordChangedEmail('a@b.c'),
      );
      expect(queue.add.mock.calls[0]![2]?.jobId).toBe(`password-changed-${sha256Hex('nonce-1')}`);
    });

    it('keys the dedupe on the server nonce, never on the caller-supplied requestId', async () => {
      // BullMQ treats a repeated job id as a no-op, so whoever controls the key
      // controls whether the mail is sent. `requestId` can arrive as an
      // `x-request-id` header; pinning it must not let a caller suppress their
      // own security alerts.
      await requestContext.run({ requestId: 'attacker-pinned', dedupeNonce: 'server-a' }, () =>
        service.sendTwoFactorDisabledEmail('a@b.c'),
      );
      await requestContext.run({ requestId: 'attacker-pinned', dedupeNonce: 'server-b' }, () =>
        service.sendTwoFactorDisabledEmail('a@b.c'),
      );

      const first = queue.add.mock.calls[0]![2]?.jobId;
      const second = queue.add.mock.calls[1]![2]?.jobId;
      expect(first).not.toBe(second);
    });

    it('sets no jobId when the request scope carries no nonce (queue worker, cron)', async () => {
      await requestContext.run({ requestId: 'req-no-nonce' }, () =>
        service.sendPasswordChangedEmail('a@b.c'),
      );
      expect(queue.add.mock.calls[0]![2]?.jobId).toBeUndefined();
    });

    it('sendEmailChangeRequestedEmail enqueues the tripwire to the old address with the new one named', async () => {
      await requestContext.run({ requestId: 'req-ec', dedupeNonce: 'nonce-ec' }, () =>
        service.sendEmailChangeRequestedEmail('old@example.com', 'new@example.com'),
      );
      expect(queue.add).toHaveBeenCalledWith(
        EMAIL_DELIVERY_JOB_NAMES.SEND_EMAIL_CHANGE_REQUESTED,
        expect.objectContaining({
          to: 'old@example.com',
          props: {
            appName: 'TestApp',
            newEmail: 'new@example.com',
            settingsUrl: 'https://app.example/settings',
          },
        }),
        expect.objectContaining({
          priority: EMAIL_DELIVERY_NON_CRITICAL_PRIORITY,
          jobId: `email-change-requested-${sha256Hex('nonce-ec')}`,
        }),
      );
    });

    it('sendTwoFactorEnabledEmail enqueues send-two-factor-enabled with a settings link', async () => {
      await service.sendTwoFactorEnabledEmail('a@b.c');
      expect(queue.add).toHaveBeenCalledWith(
        EMAIL_DELIVERY_JOB_NAMES.SEND_TWO_FACTOR_ENABLED,
        expect.objectContaining({
          to: 'a@b.c',
          props: expect.objectContaining({ appName: 'TestApp' }),
        }),
        expect.objectContaining({ priority: EMAIL_DELIVERY_NON_CRITICAL_PRIORITY }),
      );
      // Outside a request context there is no stable dedupe key: no jobId.
      expect(queue.add.mock.calls[0]![2]?.jobId).toBeUndefined();
    });

    it('sendTwoFactorEnabledEmail dedupes per originating request (hashed dedupeNonce jobId)', async () => {
      await requestContext.run({ requestId: 'req-2fa', dedupeNonce: 'nonce-2fa' }, () =>
        service.sendTwoFactorEnabledEmail('a@b.c'),
      );
      expect(queue.add.mock.calls[0]![2]?.jobId).toBe(
        `two-factor-enabled-${sha256Hex('nonce-2fa')}`,
      );
    });

    it('rethrows a non-critical enqueue failure to the caller', async () => {
      queue.add.mockRejectedValue(new Error('redis down'));
      await expect(service.sendWelcomeEmail('a@b.c', 'https://login', 'u-1')).rejects.toThrow();
    });
  });
});
