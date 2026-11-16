import type { Request, Response, NextFunction } from 'express';
import { createLogger } from '@repo/shared/logger';

jest.mock('@repo/shared/logger', () => {
  const fakeLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const createLoggerMock = jest.fn(() => fakeLogger);
  return {
    __esModule: true,
    createLogger: createLoggerMock,
    setTimestampsEnabled: jest.fn(),
    // The REAL redactor, not a stub: this middleware is the highest-volume
    // place a path-segment token (a calendar feed, say) would leak (every successful poll), so the test
    // must exercise the actual redaction rather than a pass-through.
    redactCredentialPath: jest.requireActual('@repo/shared/logger').redactCredentialPath,
  };
});

// The middleware captures its logger at module-import time via
// `const logger = createLogger('HTTP', ...)`, so reach the same fake instance
// through the recorded result of that single import-time call.
const fakeLogger = jest.mocked(createLogger).mock.results[0]!.value as {
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
};

const getRequestIdMock = jest.fn();
jest.mock('../../common/context/request-context', () => ({
  getRequestId: () => getRequestIdMock(),
}));

import { LoggerMiddleware } from './logger.middleware';

interface IFakeRes extends Pick<Response, 'on'> {
  statusCode: number;
}

const buildReq = (overrides: Partial<Request> = {}): Request =>
  ({
    method: 'GET',
    path: '/api/things',
    ...overrides,
  }) as Request;

const buildRes = (): { res: IFakeRes; runFinish: () => void } => {
  let captured: (() => void) | undefined;
  const res = {
    statusCode: 200,
    on: jest.fn((evt: string, fn: () => void) => {
      if (evt === 'finish') captured = fn;
      return res as unknown as Response;
    }),
  } as unknown as IFakeRes;
  return {
    res,
    runFinish: () => {
      if (!captured) throw new Error('finish listener was never registered');
      captured();
    },
  };
};

describe('LoggerMiddleware', () => {
  let middleware: LoggerMiddleware;
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    fakeLogger.info.mockReset();
    fakeLogger.warn.mockReset();
    fakeLogger.error.mockReset();
    getRequestIdMock.mockReset();
    getRequestIdMock.mockReturnValue('req-abc');
    middleware = new LoggerMiddleware();
    next = jest.fn();
  });

  it('skips logging entirely for /health and calls next()', () => {
    const req = buildReq({ path: '/health' });
    const { res } = buildRes();

    middleware.use(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.on).not.toHaveBeenCalled();
    expect(fakeLogger.info).not.toHaveBeenCalled();
  });

  it('registers a finish listener and calls next() for non-health routes', () => {
    const req = buildReq();
    const { res } = buildRes();

    middleware.use(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
  });

  it('logs at info level for 2xx responses', () => {
    const req = buildReq({ method: 'POST', path: '/api/login' });
    const { res, runFinish } = buildRes();

    middleware.use(req, res as unknown as Response, next);
    res.statusCode = 200;
    runFinish();

    expect(fakeLogger.info).toHaveBeenCalledTimes(1);
    expect(fakeLogger.info).toHaveBeenCalledWith('HTTP request', {
      requestId: 'req-abc',
      method: 'POST',
      path: '/api/login',
      status: 200,
      durationMs: expect.any(Number),
    });
    expect(fakeLogger.warn).not.toHaveBeenCalled();
    expect(fakeLogger.error).not.toHaveBeenCalled();
  });

  it('logs at warn level for 4xx responses', () => {
    const req = buildReq({ method: 'GET', path: '/api/missing' });
    const { res, runFinish } = buildRes();

    middleware.use(req, res as unknown as Response, next);
    res.statusCode = 404;
    runFinish();

    expect(fakeLogger.warn).toHaveBeenCalledTimes(1);
    expect(fakeLogger.warn).toHaveBeenCalledWith('HTTP request', {
      requestId: 'req-abc',
      method: 'GET',
      path: '/api/missing',
      status: 404,
      durationMs: expect.any(Number),
    });
    expect(fakeLogger.info).not.toHaveBeenCalled();
    expect(fakeLogger.error).not.toHaveBeenCalled();
  });

  it('logs at error level for 5xx responses', () => {
    const req = buildReq({ method: 'PUT', path: '/api/explode' });
    const { res, runFinish } = buildRes();

    middleware.use(req, res as unknown as Response, next);
    res.statusCode = 503;
    runFinish();

    expect(fakeLogger.error).toHaveBeenCalledTimes(1);
    expect(fakeLogger.error).toHaveBeenCalledWith('HTTP request', {
      requestId: 'req-abc',
      method: 'PUT',
      path: '/api/explode',
      status: 503,
      durationMs: expect.any(Number),
    });
  });

  it("omits requestId when getRequestId() returns 'no-context'", () => {
    getRequestIdMock.mockReturnValue('no-context');
    const req = buildReq({ method: 'GET', path: '/api/anon' });
    const { res, runFinish } = buildRes();

    middleware.use(req, res as unknown as Response, next);
    res.statusCode = 200;
    runFinish();

    expect(fakeLogger.info).toHaveBeenCalledTimes(1);
    expect(fakeLogger.info.mock.calls[0][1]).not.toHaveProperty('requestId');
    expect(fakeLogger.info.mock.calls[0][1]).toMatchObject({ method: 'GET', path: '/api/anon' });
  });

  it('reports a non-negative duration computed from Date.now()', () => {
    const req = buildReq();
    const { res, runFinish } = buildRes();

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(1_042);

    middleware.use(req, res as unknown as Response, next);
    res.statusCode = 200;
    runFinish();

    expect(fakeLogger.info.mock.calls[0][1]).toMatchObject({ durationMs: 42 });

    nowSpy.mockRestore();
  });
});
