import 'reflect-metadata';
import { HttpException, HttpStatus, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { of, throwError } from 'rxjs';

const observeMock = jest.fn();
const labelsMock = jest.fn(() => ({ observe: observeMock }));
jest.mock('./metrics.registry', () => ({
  httpRequestDuration: { labels: (...args: unknown[]) => labelsMock(...(args as [])) },
}));

import { HttpMetricsInterceptor } from './http-metrics.interceptor';

/**
 * `statusCode: 200` is not a convenience: it is express's real state at the
 * moment the interceptor's `tap` fires, because AllExceptionsFilter sets the
 * response status afterwards. Reading it on the error path is what put every
 * thrown error in the 2xx bucket.
 */
const createContext = (statusCode = 200): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', route: { path: '/api/files/:ticket' } }),
      getResponse: () => ({ statusCode }),
    }),
  }) as unknown as ExecutionContext;

const handlerReturning = (value: unknown): CallHandler =>
  ({ handle: () => of(value) }) as CallHandler;

const handlerThrowing = (error: unknown): CallHandler =>
  ({ handle: () => throwError(() => error) }) as CallHandler;

describe('HttpMetricsInterceptor', () => {
  let interceptor: HttpMetricsInterceptor;

  beforeEach(() => {
    labelsMock.mockClear();
    observeMock.mockClear();
    interceptor = new HttpMetricsInterceptor();
  });

  const run = (context: ExecutionContext, handler: CallHandler): Promise<void> =>
    new Promise((resolve) => {
      interceptor.intercept(context, handler).subscribe({
        next: () => resolve(),
        error: () => resolve(),
      });
    });

  it('records the response status class on the success path', async () => {
    await run(createContext(200), handlerReturning({ ok: true }));

    expect(labelsMock).toHaveBeenCalledWith('GET', '/api/files/:ticket', '2xx');
    expect(observeMock).toHaveBeenCalledTimes(1);
  });

  it('records 5xx for a thrown non-HttpException, not the response default of 200', async () => {
    await run(createContext(200), handlerThrowing(new Error('boom')));

    expect(labelsMock).toHaveBeenCalledWith('GET', '/api/files/:ticket', '5xx');
  });

  it('records the status the HttpException carries, not the response default', async () => {
    await run(
      createContext(200),
      handlerThrowing(new HttpException('expired ticket', HttpStatus.GONE)),
    );

    expect(labelsMock).toHaveBeenCalledWith('GET', '/api/files/:ticket', '4xx');
  });

  it('records an explicit 5xx HttpException in the 5xx bucket', async () => {
    await run(
      createContext(200),
      handlerThrowing(new HttpException('bad gateway', HttpStatus.BAD_GATEWAY)),
    );

    expect(labelsMock).toHaveBeenCalledWith('GET', '/api/files/:ticket', '5xx');
  });

  it('falls back to the unknown route label when nothing matched', async () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST' }),
        getResponse: () => ({ statusCode: 201 }),
      }),
    } as unknown as ExecutionContext;

    await run(context, handlerReturning(null));

    expect(labelsMock).toHaveBeenCalledWith('POST', 'unknown', '2xx');
  });
});
