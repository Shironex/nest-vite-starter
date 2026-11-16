import { EventEmitter } from 'node:events';
import { createLogger } from '@repo/shared/logger';
import {
  installUnhandledRejectionPolicy,
  UNHANDLED_REJECTION_EXIT_CODE,
  UNHANDLED_REJECTION_FLUSH_TIMEOUT_MS,
} from './unhandled-rejection';

/** One macrotask: every already-settled promise handler has run by then. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * The policy is "log, drain Sentry, exit(1)", and it must hold identically
 * with and without SENTRY_DSN. The two environments differ only in what
 * `flush` is: Sentry's real flush with no client resolves at once, and with a
 * client it waits on the transport. Both are driven here through a fake
 * process (an EventEmitter), so a deliberately unhandled rejection is emitted
 * exactly the way Node emits one, without a process to kill.
 */
function arrange(flush: (timeoutMs: number) => PromiseLike<unknown>) {
  const target = new EventEmitter();
  const lines: string[] = [];
  // Spy first: the logger captures console.error when it is created.
  jest.spyOn(console, 'error').mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  const logger = createLogger('Process', { structured: true, requestId: 'req-1' });
  const exit = jest.fn();
  installUnhandledRejectionPolicy(
    { logger, flush, exit },
    target as unknown as Pick<NodeJS.Process, 'on'>,
  );
  const reject = (reason: unknown): void => {
    target.emit('unhandledRejection', reason, Promise.resolve());
  };
  return { lines, exit, reject };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('unhandledRejection policy', () => {
  it('without SENTRY_DSN: logs through the structured logger, then exits 1', async () => {
    // Sentry.flush with no client resolves immediately (to false).
    const flush = jest.fn(() => Promise.resolve(false));
    const { lines, exit, reject } = arrange(flush);

    reject(new Error('fire-and-forget audit write failed'));
    await settle();

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 'error',
      context: 'Process',
      message: 'Unhandled promise rejection; exiting',
      requestId: 'req-1',
    });
    const data = entry.data as { reason: Record<string, unknown>; exitCode: number };
    expect(data.reason.message).toBe('fire-and-forget audit write failed');
    expect(String(data.reason.stack)).toContain('fire-and-forget audit write failed');
    expect(data.exitCode).toBe(1);

    expect(flush).toHaveBeenCalledWith(UNHANDLED_REJECTION_FLUSH_TIMEOUT_MS);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(UNHANDLED_REJECTION_EXIT_CODE);
  });

  it('with SENTRY_DSN: holds the exit until Sentry has drained, then exits 1', async () => {
    let drained!: () => void;
    const flush = jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          drained = () => resolve(true);
        }),
    );
    const { lines, exit, reject } = arrange(flush);

    reject(new Error('boom'));
    await settle();

    // Logged at once, but the event Sentry captured is still in flight.
    expect(lines).toHaveLength(1);
    expect(exit).not.toHaveBeenCalled();

    drained();
    await settle();

    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(UNHANDLED_REJECTION_EXIT_CODE);
  });

  it('still exits when the flush itself fails', async () => {
    const { exit, reject } = arrange(() => Promise.reject(new Error('transport down')));

    reject(new Error('boom'));
    await settle();

    expect(exit).toHaveBeenCalledWith(UNHANDLED_REJECTION_EXIT_CODE);
  });

  it('logs every rejection but exits once while the first is draining', async () => {
    let drained!: () => void;
    const flush = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          drained = resolve;
        }),
    );
    const { lines, exit, reject } = arrange(flush);

    reject(new Error('first'));
    reject('a thrown string');
    drained();
    await settle();

    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('a thrown string');
    expect(flush).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('redacts a secret carried by the rejection reason', async () => {
    const { lines, reject } = arrange(() => Promise.resolve(false));

    reject(new Error('upstream refused Bearer sk_live_sentinelToken'));
    await settle();

    expect(lines[0]).not.toContain('sk_live_sentinelToken');
  });
});
