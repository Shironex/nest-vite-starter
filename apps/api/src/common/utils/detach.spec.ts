const errorMock = jest.fn();

jest.mock('../../modules/logger/logger.service', () => ({
  createAppLogger: () => ({
    error: (...args: unknown[]) => errorMock(...args),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  }),
}));

import { detach } from './detach';

/** One macrotask: every already-settled promise handler has run by then. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('detach', () => {
  const unhandled = jest.fn();

  beforeEach(() => {
    errorMock.mockReset();
    unhandled.mockReset();
    process.on('unhandledRejection', unhandled);
  });

  afterEach(() => {
    process.off('unhandledRejection', unhandled);
  });

  it('logs a rejecting task with its context and never rejects the caller', async () => {
    const failure = new Error('smtp down');

    // Synchronous and void: the caller has nothing to await and nothing to catch.
    expect(detach(Promise.reject(failure), { task: 'mail.send', userId: 'u-1' })).toBeUndefined();
    await settle();

    expect(errorMock).toHaveBeenCalledTimes(1);
    expect(errorMock).toHaveBeenCalledWith('Detached task failed', {
      task: 'mail.send',
      userId: 'u-1',
      err: failure,
    });
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('logs a non-Error rejection value as is', async () => {
    detach(Promise.reject('a thrown string'), { task: 'cache.purge' });
    await settle();

    expect(errorMock).toHaveBeenCalledWith('Detached task failed', {
      task: 'cache.purge',
      err: 'a thrown string',
    });
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('stays silent when the task succeeds', async () => {
    detach(Promise.resolve('done'), { task: 'audit.write' });
    await settle();

    expect(errorMock).not.toHaveBeenCalled();
    expect(unhandled).not.toHaveBeenCalled();
  });
});
