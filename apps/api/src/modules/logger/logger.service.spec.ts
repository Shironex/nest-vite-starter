import type { Logger } from '@repo/shared/logger';
import { createLogger, setTimestampsEnabled } from '@repo/shared/logger';

/*
 * Partial mock: only the two sinks are stubbed. `normalizeError` stays REAL,
 * because the Error-flattening assertion below is about its actual behavior:
 * an automock would return undefined and quietly turn that test green.
 */
jest.mock('@repo/shared/logger', () => ({
  ...jest.requireActual<object>('@repo/shared/logger'),
  createLogger: jest.fn(),
  setTimestampsEnabled: jest.fn(),
}));

const createLoggerMock = jest.mocked(createLogger);
const setTimestampsEnabledMock = jest.mocked(setTimestampsEnabled);

import { CustomLogger } from './logger.service';

const buildFakeLogger = (): jest.Mocked<Logger> =>
  ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }) as unknown as jest.Mocked<Logger>;

describe('CustomLogger', () => {
  let service: CustomLogger;

  beforeEach(() => {
    createLoggerMock.mockReset();
    createLoggerMock.mockImplementation(() => buildFakeLogger());
    service = new CustomLogger();
  });

  it('enables timestamps once at module import time', () => {
    expect(setTimestampsEnabledMock).toHaveBeenCalledWith(true);
  });

  describe('logger cache (memoization)', () => {
    it('reuses the same Logger instance for repeated calls with the same context', () => {
      service.log('first', 'CtxA');
      service.log('second', 'CtxA');

      expect(createLoggerMock).toHaveBeenCalledTimes(1);
      expect(createLoggerMock).toHaveBeenCalledWith(
        'CtxA',
        expect.objectContaining({ getRequestId: expect.any(Function) }),
      );
    });

    it('creates a fresh Logger per distinct context', () => {
      service.log('a', 'CtxA');
      service.log('b', 'CtxB');
      service.log('c', 'CtxC');

      expect(createLoggerMock).toHaveBeenCalledTimes(3);
      expect(createLoggerMock).toHaveBeenNthCalledWith(1, 'CtxA', expect.any(Object));
      expect(createLoggerMock).toHaveBeenNthCalledWith(2, 'CtxB', expect.any(Object));
      expect(createLoggerMock).toHaveBeenNthCalledWith(3, 'CtxC', expect.any(Object));
    });
  });

  describe("default 'App' context fallback", () => {
    it.each([
      ['log', 'info'],
      ['warn', 'warn'],
      ['debug', 'debug'],
      ['verbose', 'debug'],
    ] as const)('%s() with no context routes to %s on the App logger', (method, sink) => {
      const fake = buildFakeLogger();
      createLoggerMock.mockReturnValueOnce(fake);

      (service[method] as (msg: string) => void)('hello');

      expect(createLoggerMock).toHaveBeenCalledWith('App', expect.any(Object));
      expect(fake[sink]).toHaveBeenCalledWith('hello');
    });

    it('error() with no context defaults to App and only logs the message when no trace', () => {
      const fake = buildFakeLogger();
      createLoggerMock.mockReturnValueOnce(fake);

      service.error('boom');

      expect(createLoggerMock).toHaveBeenCalledWith('App', expect.any(Object));
      expect(fake.error).toHaveBeenCalledTimes(1);
      expect(fake.error).toHaveBeenCalledWith('boom');
    });
  });

  describe('error() trace branch', () => {
    it('passes message and trace in a single structured error call', () => {
      const fake = buildFakeLogger();
      createLoggerMock.mockReturnValueOnce(fake);

      service.error('boom', 'stack-trace-here', 'Worker');

      expect(createLoggerMock).toHaveBeenCalledWith('Worker', expect.any(Object));
      expect(fake.error).toHaveBeenCalledTimes(1);
      expect(fake.error).toHaveBeenCalledWith('boom', 'stack-trace-here');
    });

    it('skips the trace arg when trace is the empty string (falsy)', () => {
      const fake = buildFakeLogger();
      createLoggerMock.mockReturnValueOnce(fake);

      service.error('boom', '', 'Worker');

      expect(fake.error).toHaveBeenCalledTimes(1);
      expect(fake.error).toHaveBeenCalledWith('boom');
    });

    it('normalizes an Error into a plain object so its stack survives', () => {
      const fake = buildFakeLogger();
      createLoggerMock.mockReturnValueOnce(fake);

      const err = new Error('kaboom');
      service.error('failed', err, 'Worker');

      expect(fake.error).toHaveBeenCalledTimes(1);
      expect(fake.error).toHaveBeenCalledWith('failed', {
        name: 'Error',
        message: 'kaboom',
        stack: expect.any(String),
      });
    });
  });

  it('honors an explicit context across all level methods', () => {
    const fake = buildFakeLogger();
    createLoggerMock.mockReturnValueOnce(fake);

    service.log('m1', 'Ctx');
    service.warn('m2', 'Ctx');
    service.debug('m3', 'Ctx');
    service.verbose('m4', 'Ctx');

    expect(createLoggerMock).toHaveBeenCalledTimes(1);
    expect(fake.info).toHaveBeenCalledWith('m1');
    expect(fake.warn).toHaveBeenCalledWith('m2');
    expect(fake.debug).toHaveBeenNthCalledWith(1, 'm3');
    expect(fake.debug).toHaveBeenNthCalledWith(2, 'm4');
  });
});
