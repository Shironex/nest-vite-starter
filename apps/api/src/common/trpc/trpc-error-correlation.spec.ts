import { initTRPC } from '@trpc/server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import type { Request } from 'express';
import { getRequestId, requestContext } from '../context/request-context';

const errorMock = jest.fn();
const warnMock = jest.fn();

/**
 * What `getRequestId()` resolved to when each line was written. The real logger
 * stamps its structured `requestId` field the same way (createAppLogger in
 * modules/logger/logger.service.ts), so recording it is equivalent to asserting
 * on the field, without depending on the logger's formatting.
 */
const loggedRequestIds: string[] = [];

jest.mock('../../modules/logger/logger.service', () => ({
  createAppLogger: () => ({
    error: (...args: unknown[]) => {
      loggedRequestIds.push(getRequestId());
      errorMock(...args);
    },
    warn: (...args: unknown[]) => {
      loggedRequestIds.push(getRequestId());
      warnMock(...args);
    },
    info: jest.fn(),
    debug: jest.fn(),
  }),
}));

const captureExceptionMock = jest.fn();
jest.mock('@sentry/nestjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

import { TrpcRequestContextMiddleware } from './trpc-request-context.middleware';
import { AppErrorHandler } from '../../trpc/trpc.error-handler';

/**
 * End-to-end correlation check across the REAL @trpc/server request pipeline.
 *
 * The fix rests on an internal @trpc/server behavior that no hand-built `opts`
 * can exercise: `resolveResponse` hands `onError` the object `createContext`
 * returned, which is the same reference the first middleware receives, while
 * `next({ ctx })` only ever builds a fresh object for downstream. If a tRPC
 * upgrade changed either half, the unit specs on both sides would still pass and
 * production would silently go back to logging the 'no-context' sentinel on
 * every tRPC failure. This spec drives a real request through the real handler
 * so that regression fails here instead.
 */
describe('tRPC error-path requestId correlation (wire level)', () => {
  const contextMiddleware = new TrpcRequestContextMiddleware();
  const errorHandler = new AppErrorHandler();

  const t = initTRPC.context<{ req: Request }>().create();
  const procedure = t.procedure.use(
    async (opts) =>
      // nestjs-trpc types a middleware result without @trpc/server's internal
      // `marker` brand, but `use` resolves to exactly what `opts.next()` did, so
      // the value handed back here IS a tRPC MiddlewareResult.
      (await contextMiddleware.use(
        opts as unknown as Parameters<TrpcRequestContextMiddleware['use']>[0],
      )) as Awaited<ReturnType<typeof opts.next>>,
  );

  const router = t.router({
    boom: procedure.query(() => {
      throw new Error('resolver blew up');
    }),
    fine: procedure.query(() => getRequestId()),
  });

  const buildReq = (requestId?: string): Request =>
    ({
      method: 'POST',
      originalUrl: '/trpc/boom',
      headers: requestId === undefined ? {} : { 'x-request-id': requestId },
      ip: '203.0.113.7',
    }) as unknown as Request;

  const call = async (path: string, req: Request): Promise<Response> =>
    fetchRequestHandler({
      endpoint: '/trpc',
      req: new globalThis.Request(`http://api.test/trpc/${path}`),
      router,
      createContext: () => ({ req }),
      onError: (opts) => {
        errorHandler.onError(opts as unknown as Parameters<AppErrorHandler['onError']>[0]);
      },
    });

  beforeEach(() => {
    errorMock.mockReset();
    warnMock.mockReset();
    captureExceptionMock.mockReset();
    loggedRequestIds.length = 0;
  });

  it('reports the request id to Sentry rather than the no-context sentinel', async () => {
    await call('boom', buildReq('req-e2e-1'));

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      extra: expect.objectContaining({
        procedure: 'boom',
        requestId: 'req-e2e-1',
      }),
    });
  });

  it('stamps the same id onto every log line the failure emits', async () => {
    await call('boom', buildReq('req-e2e-2'));

    expect(loggedRequestIds.length).toBeGreaterThan(0);
    expect(new Set(loggedRequestIds)).toEqual(new Set(['req-e2e-2']));
  });

  it('carries a server-minted id when the caller supplied none', async () => {
    await call('boom', buildReq());

    const [reported] = captureExceptionMock.mock.calls as [
      [unknown, { extra: { requestId: unknown } }],
    ];
    const requestId = reported[1].extra.requestId;
    expect(requestId).toEqual(expect.any(String));
    expect(requestId).not.toBe('no-context');
    expect(loggedRequestIds).toContain(requestId);
  });

  it('gives an error and a success on the same id the same correlation', async () => {
    // The whole point of the issue: an operator searching one requestId must
    // find both the successful lines and the failing ones.
    const okBody = (await (await call('fine', buildReq('req-e2e-shared'))).json()) as {
      result: { data: string };
    };
    await call('boom', buildReq('req-e2e-shared'));

    expect(okBody.result.data).toBe('req-e2e-shared');
    expect(loggedRequestIds).toContain('req-e2e-shared');
  });

  it('does not leave the restored scope open after the response', async () => {
    await call('boom', buildReq('req-e2e-3'));

    expect(requestContext.getStore()).toBeUndefined();
  });
});
