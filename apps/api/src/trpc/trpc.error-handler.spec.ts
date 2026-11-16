import { AppErrorCode } from '@repo/shared/errors';
import { TRPCError } from '@trpc/server';
import { ConcurrencyError } from '../common/database/concurrency-error';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../common/errors';
import { getRequestId, requestContext } from '../common/context/request-context';

const errorMock = jest.fn();
const warnMock = jest.fn();

/**
 * What `getRequestId()` resolved to at the moment each line was written. The
 * real logger stamps its structured `requestId` field the same way (see
 * createAppLogger in modules/logger/logger.service.ts), so recording it here
 * pins the correlation without depending on the logger's own formatting.
 */
const loggedRequestIds: string[] = [];

jest.mock('../modules/logger/logger.service', () => ({
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

import { AppErrorHandler, appErrorFormatter, resolveAppErrorCode } from './trpc.error-handler';

const buildOpts = (
  overrides: {
    code?: string;
    message?: string;
    cause?: unknown;
    type?: 'mutation' | 'query' | 'subscription' | 'unknown';
    path?: string;
    ctx?: Record<string, unknown> | undefined;
  } = {},
) => {
  const error = {
    code: overrides.code ?? 'INTERNAL_SERVER_ERROR',
    message: overrides.message ?? 'boom',
    cause: overrides.cause,
  };
  return {
    error: error as unknown as Parameters<AppErrorHandler['onError']>[0]['error'],
    type: overrides.type ?? ('mutation' as const),
    path: overrides.path ?? 'auth.login',
    input: undefined,
    ctx: 'ctx' in overrides ? overrides.ctx : {},
  } as Parameters<AppErrorHandler['onError']>[0];
};

describe('AppErrorHandler', () => {
  let handler: AppErrorHandler;

  beforeEach(() => {
    handler = new AppErrorHandler();
    errorMock.mockReset();
    warnMock.mockReset();
    captureExceptionMock.mockReset();
    loggedRequestIds.length = 0;
  });

  describe('TRPC → AppErrorCode mapping', () => {
    it.each([
      ['BAD_REQUEST', 'VALIDATION_ERROR'],
      ['UNAUTHORIZED', 'UNAUTHORIZED'],
      ['FORBIDDEN', 'FORBIDDEN'],
      ['NOT_FOUND', 'NOT_FOUND'],
      ['CONFLICT', 'CONFLICT'],
      ['TOO_MANY_REQUESTS', 'RATE_LIMITED'],
      ['PAYLOAD_TOO_LARGE', 'PAYLOAD_TOO_LARGE'],
      ['INTERNAL_SERVER_ERROR', 'INTERNAL_ERROR'],
      ['TIMEOUT', 'INTERNAL_ERROR'],
      ['PARSE_ERROR', 'INTERNAL_ERROR'],
      ['METHOD_NOT_SUPPORTED', 'INTERNAL_ERROR'],
      ['UNPROCESSABLE_CONTENT', 'INTERNAL_ERROR'],
      ['CLIENT_CLOSED_REQUEST', 'INTERNAL_ERROR'],
      ['PRECONDITION_FAILED', 'INTERNAL_ERROR'],
    ])('logs %s with appCode %s', (code, expectedAppCode) => {
      const opts = buildOpts({ code, message: 'msg' });
      handler.onError(opts);
      // The level follows the appCode, matching the DomainError branch: only
      // INTERNAL_ERROR is a fault, everything else is client-caused.
      const expected = expectedAppCode === 'INTERNAL_ERROR' ? errorMock : warnMock;
      expect(expected).toHaveBeenCalledWith(
        expect.stringContaining(`(${expectedAppCode})`),
        expect.any(Object),
      );
    });

    it('logs a client-caused code at warn, never error', () => {
      // Zod input validation arrives as BAD_REQUEST. One ERROR line per submit
      // for a UI regression that sends a malformed field would drown the real
      // INTERNAL errors the Sentry gate is looking for.
      handler.onError(buildOpts({ code: 'BAD_REQUEST', message: 'invalid date' }));

      expect(errorMock).not.toHaveBeenCalled();
      expect(warnMock).toHaveBeenCalledWith(
        expect.stringContaining('(VALIDATION_ERROR)'),
        expect.any(Object),
      );
    });

    it('logs the cause of a client-caused code at warn too', () => {
      handler.onError(
        buildOpts({ code: 'BAD_REQUEST', message: 'invalid date', cause: new Error('zod') }),
      );

      expect(errorMock).not.toHaveBeenCalled();
      expect(warnMock).toHaveBeenCalledWith(
        'tRPC error cause [mutation] auth.login',
        expect.objectContaining({ err: expect.objectContaining({ message: 'zod' }) }),
      );
    });

    it('falls back to INTERNAL_ERROR for unknown TRPC error codes', () => {
      const opts = buildOpts({ code: 'WEIRD_CODE', message: 'mystery' });
      handler.onError(opts);
      expect(errorMock).toHaveBeenCalledWith(
        expect.stringContaining('(INTERNAL_ERROR)'),
        expect.any(Object),
      );
    });

    it('does not mutate error.code when there is no cause', () => {
      const opts = buildOpts({ code: 'BAD_REQUEST', message: 'original' });
      handler.onError(opts);
      expect(opts.error.code).toBe('BAD_REQUEST');
    });

    it('logs cause when error has a non-Prisma, non-Concurrency cause', () => {
      const cause = new Error('underlying');
      const opts = buildOpts({ code: 'INTERNAL_SERVER_ERROR', message: 'wrap', cause });
      handler.onError(opts);
      expect(errorMock).toHaveBeenCalledWith(
        expect.stringContaining('(INTERNAL_ERROR)'),
        expect.any(Object),
      );
      expect(errorMock).toHaveBeenCalledWith(
        'tRPC error cause [mutation] auth.login',
        expect.objectContaining({
          err: expect.objectContaining({ name: 'Error', message: 'underlying' }),
        }),
      );
    });
  });

  /*
   * @trpc/server wraps any non-TRPCError throw into INTERNAL_SERVER_ERROR with
   * the thrown message intact, so a bare `throw new Error(...)` deep in a
   * service carries its operator-facing text (row ids, column names) all the
   * way to the browser unless the boundary stops it. The HTTP boundary defaults
   * these to a generic string; these pin the same rule at the tRPC boundary.
   */
  describe('INTERNAL_ERROR-class message sanitization', () => {
    it('replaces the client-facing message of an unexpected failure', () => {
      const opts = buildOpts({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'User u-42 has a corrupt totpSecretEnc column',
      });

      handler.onError(opts);

      expect(opts.error.message).toBe('Internal server error');
    });

    it.each(['TIMEOUT', 'PARSE_ERROR', 'WEIRD_UNMAPPED_CODE'])(
      'sanitizes %s too, since it resolves to INTERNAL_ERROR',
      (code) => {
        const opts = buildOpts({ code, message: 'internal detail' });
        handler.onError(opts);
        expect(opts.error.message).toBe('Internal server error');
      },
    );

    it.each([
      ['BAD_REQUEST', 'Start date must be before end date'],
      ['NOT_FOUND', 'Workspace not found'],
      ['FORBIDDEN', 'You can only access your own files'],
      ['TOO_MANY_REQUESTS', 'Too many attempts'],
      ['CONFLICT', 'Already exists'],
      // Since PAYLOAD_TOO_LARGE became its own appCode it is a client error
      // like the rest of this list: nothing about the body's CONTENT is in the
      // message, only that there was too much of it.
      ['PAYLOAD_TOO_LARGE', 'Request body is too large'],
    ])('passes a %s message through unchanged (the web client shows it)', (code, message) => {
      const opts = buildOpts({ code, message });
      handler.onError(opts);
      expect(opts.error.message).toBe(message);
    });

    it('keeps the ORIGINAL message in the log line', () => {
      const opts = buildOpts({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'User u-42 has a corrupt totpSecretEnc column',
      });

      handler.onError(opts);

      // In a data field, never interpolated into the line: the logger's
      // redaction walks data, and the line stays a constant to search on.
      expect(errorMock).toHaveBeenCalledWith('tRPC error [mutation] auth.login (INTERNAL_ERROR)', {
        errorMessage: 'User u-42 has a corrupt totpSecretEnc column',
      });
    });

    it("never logs a Prisma validation error's argument values", () => {
      // PrismaClientValidationError prints the offending call's argument tree,
      // values included. A name has no shape the logger's value scrub can
      // recognize, so it must not reach a log field at all.
      const cause = new Error(
        [
          '',
          'Invalid `prisma.workspace.create()` invocation:',
          '',
          '{',
          '  data: {',
          '    phone: "5550100123",',
          '    firstName: "Jonathan",',
          '  }',
          '}',
          '',
          'Argument `lastName` is missing.',
        ].join('\n'),
      );
      cause.name = 'PrismaClientValidationError';
      const opts = buildOpts({ code: 'INTERNAL_SERVER_ERROR', message: cause.message, cause });

      handler.onError(opts);

      const logged = JSON.stringify(errorMock.mock.calls);
      expect(logged).not.toContain('5550100123');
      expect(logged).not.toContain('Jonathan');
      expect(errorMock).toHaveBeenCalledWith('tRPC error [mutation] auth.login (INTERNAL_ERROR)', {
        errorMessage: 'Argument `lastName` is missing.',
      });
      const causeCall = errorMock.mock.calls.find(
        (call) => call[0] === 'tRPC error cause [mutation] auth.login',
      );
      const err = (causeCall?.[1] as { err: Record<string, unknown> }).err;
      expect(err.name).toBe('PrismaClientValidationError');
      expect(err.message).toBe('Argument `lastName` is missing.');
      // The frames survive, so the failing call site is still findable.
      expect(String(err.stack)).toMatch(/\n\s+at /);
    });

    it('reports the ORIGINAL message to Sentry (capture runs before the rewrite)', () => {
      const opts = buildOpts({ code: 'INTERNAL_SERVER_ERROR', message: 'corrupt row emp-42' });

      handler.onError(opts);

      // With no cause, Sentry captures the wrapper error object itself (the
      // very object whose message is rewritten a line later), so the handler
      // snapshots the message into `extra` rather than leaving Sentry to read
      // it off a mutated reference.
      expect(captureExceptionMock).toHaveBeenCalledTimes(1);
      expect(captureExceptionMock).toHaveBeenCalledWith(opts.error, {
        extra: expect.objectContaining({ errorMessage: 'corrupt row emp-42' }),
      });
    });

    it('leaves a promoted DomainError message alone', () => {
      const cause = new NotFoundError();
      const opts = buildOpts({ code: 'INTERNAL_SERVER_ERROR', message: 'wrap', cause });
      handler.onError(opts);
      expect(opts.error.message).toBe(cause.message);
    });

    it('leaves the Prisma branch to its own (already safe) messages', () => {
      const cause = {
        name: 'PrismaClientKnownRequestError',
        code: 'P2025',
        message: 'record not found',
      };
      const opts = buildOpts({ code: 'INTERNAL_SERVER_ERROR', message: 'wrap', cause });
      handler.onError(opts);
      expect(opts.error.message).toBe('Resource not found');
    });
  });

  /*
   * An Error's own properties are non-enumerable, so `JSON.stringify(new
   * Error('boom'))` is `{}`. Passing the cause positionally therefore emits
   * `{"level":"error","context":"tRPC","message":"{}"}` in production, stack
   * and all, and when SENTRY_DSN is unset that log line is the only copy.
   */
  describe('cause logging keeps the stack', () => {
    it('logs the cause message and a flattened err object, never "{}"', () => {
      const cause = new Error('the real failure');
      const opts = buildOpts({ code: 'INTERNAL_SERVER_ERROR', message: 'wrap', cause });

      handler.onError(opts);

      const causeCall = errorMock.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('tRPC error cause'),
      );
      expect(causeCall).toBeDefined();
      const err = (causeCall?.[1] as { err: Record<string, unknown> }).err;
      expect(err.name).toBe('Error');
      expect(err.message).toBe('the real failure');
      expect(String(err.stack)).toContain('the real failure');
      expect(JSON.stringify(err)).not.toBe('{}');
    });

    it('handles a non-Error cause without pretending it has a stack', () => {
      const opts = buildOpts({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'wrap',
        cause: 'a thrown string',
      });

      handler.onError(opts);

      expect(errorMock).toHaveBeenCalledWith('tRPC error cause [mutation] auth.login', {
        err: 'a thrown string',
      });
    });
  });

  describe('ConcurrencyError handling', () => {
    it('promotes ConcurrencyError cause to CONFLICT and rewrites message', () => {
      const cause = new ConcurrencyError('User', 'u-1', 7);
      const opts = buildOpts({ code: 'INTERNAL_SERVER_ERROR', message: 'oops', cause });
      handler.onError(opts);
      expect(opts.error.code).toBe('CONFLICT');
      expect(opts.error.message).toBe('Resource was modified by another writer');
      expect(warnMock).toHaveBeenCalledWith('tRPC concurrency conflict', {
        type: 'mutation',
        path: 'auth.login',
        reason: cause.message,
      });
      expect(errorMock).not.toHaveBeenCalled();
    });
  });

  describe('Prisma error sanitization', () => {
    it('rewrites P2002 message to "Resource already exists"', () => {
      const cause = {
        name: 'PrismaClientKnownRequestError',
        code: 'P2002',
        message: 'unique constraint failed on (email)',
      };
      const opts = buildOpts({ code: 'BAD_REQUEST', message: 'bad', cause });
      handler.onError(opts);
      expect(opts.error.message).toBe('Resource already exists');
      expect(errorMock).toHaveBeenCalledWith('tRPC Prisma error', {
        type: 'mutation',
        path: 'auth.login',
        appCode: expect.any(String),
        prismaCode: 'P2002',
        prismaMessage: 'unique constraint failed on (email)',
      });
    });

    it('promotes P2025 to NOT_FOUND and rewrites the message', () => {
      const cause = {
        name: 'PrismaClientKnownRequestError',
        code: 'P2025',
        message: 'record not found',
      };
      const opts = buildOpts({ code: 'INTERNAL_SERVER_ERROR', message: 'wrap', cause });
      handler.onError(opts);
      expect(opts.error.code).toBe('NOT_FOUND');
      expect(opts.error.message).toBe('Resource not found');
      expect(warnMock).toHaveBeenCalledWith(
        'tRPC promoted Prisma error',
        expect.objectContaining({
          code: 'NOT_FOUND',
          path: 'auth.login',
          prismaCode: 'P2025',
          prismaMessage: 'record not found',
        }),
      );
      expect(errorMock).not.toHaveBeenCalled();
    });

    it('does NOT page Sentry for a P2025 (a routine 404, not a fault)', () => {
      // A tenant-scoped update/delete against a foreign or missing id raises
      // P2025 by design, so this must not be an attacker-triggerable way to
      // generate Sentry events.
      const cause = {
        name: 'PrismaClientKnownRequestError',
        code: 'P2025',
        message: 'record not found',
      };
      const opts = buildOpts({ code: 'INTERNAL_SERVER_ERROR', message: 'wrap', cause });
      handler.onError(opts);
      expect(captureExceptionMock).not.toHaveBeenCalled();
    });

    it('leaves P2002 unpromoted so a missing unique-constraint guard still alerts', () => {
      const cause = {
        name: 'PrismaClientKnownRequestError',
        code: 'P2002',
        message: 'unique constraint failed',
      };
      const opts = buildOpts({ code: 'INTERNAL_SERVER_ERROR', message: 'wrap', cause });
      handler.onError(opts);
      expect(opts.error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    });

    it('rewrites unknown Prisma codes to "Internal server error"', () => {
      const cause = {
        name: 'PrismaClientKnownRequestError',
        code: 'P9999',
        message: 'leak this',
      };
      const opts = buildOpts({ code: 'BAD_REQUEST', message: 'bad', cause });
      handler.onError(opts);
      expect(opts.error.message).toBe('Internal server error');
    });

    it('does NOT rewrite when cause has Prisma-shaped code but missing name (duck-type fail)', () => {
      const cause = { code: 'P2002', message: 'leak' };
      const opts = buildOpts({ code: 'BAD_REQUEST', message: 'original', cause });
      handler.onError(opts);
      expect(opts.error.message).toBe('original');
    });

    it('does NOT rewrite when cause.code does not start with P', () => {
      const cause = { name: 'PrismaClientKnownRequestError', code: 'X1234', message: 'leak' };
      const opts = buildOpts({ code: 'BAD_REQUEST', message: 'original', cause });
      handler.onError(opts);
      expect(opts.error.message).toBe('original');
    });
  });

  describe('Sentry capture', () => {
    it('captures the cause of an INTERNAL_SERVER_ERROR-class failure with procedure context', () => {
      const cause = new Error('underlying');
      const opts = buildOpts({ code: 'INTERNAL_SERVER_ERROR', message: 'wrap', cause });

      handler.onError(opts);

      expect(captureExceptionMock).toHaveBeenCalledTimes(1);
      expect(captureExceptionMock).toHaveBeenCalledWith(cause, {
        extra: expect.objectContaining({
          procedure: 'auth.login',
          type: 'mutation',
          trpcCode: 'INTERNAL_SERVER_ERROR',
        }),
      });
    });

    it('captures the wrapper error itself when there is no cause', () => {
      const opts = buildOpts({ code: 'INTERNAL_SERVER_ERROR', message: 'boom' });
      handler.onError(opts);
      expect(captureExceptionMock).toHaveBeenCalledWith(opts.error, expect.any(Object));
    });

    it('captures a Prisma cause when the wrapping code is INTERNAL_SERVER_ERROR-class', () => {
      const cause = {
        name: 'PrismaClientKnownRequestError',
        code: 'P2002',
        message: 'unique constraint failed',
      };
      const opts = buildOpts({ code: 'INTERNAL_SERVER_ERROR', message: 'wrap', cause });
      handler.onError(opts);
      expect(captureExceptionMock).toHaveBeenCalledWith(cause, expect.any(Object));
    });

    it('does NOT capture expected domain errors (DomainError cause)', () => {
      const cause = new NotFoundError();
      const opts = buildOpts({ code: 'INTERNAL_SERVER_ERROR', message: 'wrap', cause });
      handler.onError(opts);
      expect(captureExceptionMock).not.toHaveBeenCalled();
    });

    it('does NOT capture concurrency conflicts (retryable, expected)', () => {
      const cause = new ConcurrencyError('User', 'u-1', 7);
      const opts = buildOpts({ code: 'INTERNAL_SERVER_ERROR', message: 'oops', cause });
      handler.onError(opts);
      expect(captureExceptionMock).not.toHaveBeenCalled();
    });

    it.each(['BAD_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'TOO_MANY_REQUESTS'])(
      'does NOT capture client-caused %s errors',
      (code) => {
        const opts = buildOpts({ code, message: 'client error' });
        handler.onError(opts);
        expect(captureExceptionMock).not.toHaveBeenCalled();
      },
    );
  });

  describe('requestId correlation', () => {
    // tRPC calls onError from its own catch, above every middleware and after
    // TrpcRequestContextMiddleware's `requestContext.run` has returned, so the
    // ALS store is gone. The middleware publishes the id onto the tRPC ctx
    // object instead; this handler re-opens a scope from it so the Sentry event
    // and the log lines carry the request's real id rather than 'no-context'.
    it('reports the published requestId to Sentry instead of the no-context sentinel', () => {
      const cause = new Error('underlying');
      const opts = buildOpts({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'wrap',
        cause,
        ctx: { requestId: 'req-from-ctx' },
      });

      handler.onError(opts);

      expect(captureExceptionMock).toHaveBeenCalledWith(cause, {
        extra: expect.objectContaining({ requestId: 'req-from-ctx' }),
      });
    });

    it('stamps the published requestId onto every log line the failure emits', () => {
      const opts = buildOpts({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'wrap',
        cause: new Error('underlying'),
        ctx: { requestId: 'req-from-ctx' },
      });

      handler.onError(opts);

      // The message line plus the cause line.
      expect(loggedRequestIds).toHaveLength(2);
      expect(loggedRequestIds).toEqual(['req-from-ctx', 'req-from-ctx']);
    });

    it('correlates the warn-only paths too (promoted domain and Prisma outcomes)', () => {
      const domain = buildOpts({
        code: 'INTERNAL_SERVER_ERROR',
        cause: new NotFoundError(),
        ctx: { requestId: 'req-domain' },
      });
      const prisma = buildOpts({
        code: 'INTERNAL_SERVER_ERROR',
        cause: {
          name: 'PrismaClientKnownRequestError',
          code: 'P2025',
          message: 'record not found',
        },
        ctx: { requestId: 'req-prisma' },
      });

      handler.onError(domain);
      handler.onError(prisma);

      expect(loggedRequestIds).toEqual(['req-domain', 'req-prisma']);
    });

    it('falls back to the sentinel when the middleware never published an id', () => {
      // An unknown procedure path or a createContext that itself threw: there is
      // no request scope to correlate to, and the handler must still not throw.
      const opts = buildOpts({ code: 'INTERNAL_SERVER_ERROR', message: 'wrap', ctx: undefined });

      handler.onError(opts);

      expect(loggedRequestIds).toEqual(['no-context']);
      expect(captureExceptionMock).toHaveBeenCalledWith(opts.error, {
        extra: expect.objectContaining({ requestId: 'no-context' }),
      });
    });

    it('ignores a non-string requestId on the ctx', () => {
      const opts = buildOpts({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'wrap',
        ctx: { requestId: { nested: 'not-an-id' } },
      });

      handler.onError(opts);

      expect(captureExceptionMock).toHaveBeenCalledWith(opts.error, {
        extra: expect.objectContaining({ requestId: 'no-context' }),
      });
    });

    it('keeps a live outer store rather than replacing it with an id-only one', () => {
      // A store carrying userId/tenantId must survive: the published id is the
      // same value anyway, so there is nothing to gain by swapping it out.
      const opts = buildOpts({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'wrap',
        ctx: { requestId: 'req-from-ctx' },
      });

      requestContext.run({ requestId: 'req-from-ctx', tenantId: 'ten-1' }, () => {
        handler.onError(opts);
        expect(requestContext.getStore()?.tenantId).toBe('ten-1');
      });

      expect(loggedRequestIds).toEqual(['req-from-ctx']);
    });

    it('does not leak the restored scope past the handler', () => {
      const opts = buildOpts({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'wrap',
        ctx: { requestId: 'req-from-ctx' },
      });

      handler.onError(opts);

      expect(requestContext.getStore()).toBeUndefined();
    });
  });
});

describe('resolveAppErrorCode', () => {
  it('returns the DomainError appCode when the cause is a DomainError', () => {
    const cause = new ForbiddenError(AppErrorCode.ACCOUNT_LOCKED);
    expect(resolveAppErrorCode({ code: 'FORBIDDEN', cause })).toBe(AppErrorCode.ACCOUNT_LOCKED);
  });

  it('returns INVALID_CREDENTIALS for a wrong-current-password UnauthorizedError', () => {
    const cause = new UnauthorizedError(
      AppErrorCode.INVALID_CREDENTIALS,
      'Current password is incorrect',
    );
    expect(resolveAppErrorCode({ code: 'UNAUTHORIZED', cause })).toBe(
      AppErrorCode.INVALID_CREDENTIALS,
    );
  });

  it('falls back to the tRPC-code mapping when there is no DomainError cause', () => {
    expect(resolveAppErrorCode({ code: 'TOO_MANY_REQUESTS' })).toBe(AppErrorCode.RATE_LIMITED);
    expect(resolveAppErrorCode({ code: 'UNAUTHORIZED', cause: new Error('x') })).toBe(
      AppErrorCode.UNAUTHORIZED,
    );
  });

  it('falls back to INTERNAL_ERROR for unknown tRPC codes', () => {
    expect(resolveAppErrorCode({ code: 'WEIRD_CODE' })).toBe(AppErrorCode.INTERNAL_ERROR);
  });
});

describe('appErrorFormatter', () => {
  const baseShape = {
    message: 'msg',
    code: -32603,
    data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 },
  };

  it('adds data.appCode from a DomainError cause while preserving the shape', () => {
    const cause = new NotFoundError();
    const shaped = appErrorFormatter({
      shape: baseShape as Parameters<typeof appErrorFormatter>[0]['shape'],
      error: new TRPCError({ code: 'NOT_FOUND', cause }),
      type: 'query',
      path: 'user.byId',
      input: undefined,
      ctx: undefined,
    });
    expect(shaped.data.appCode).toBe(AppErrorCode.NOT_FOUND);
    expect(shaped.message).toBe('msg');
    expect(shaped.data.httpStatus).toBe(500);
  });

  it('adds the mapped data.appCode for a plain TRPCError', () => {
    const shaped = appErrorFormatter({
      shape: baseShape as Parameters<typeof appErrorFormatter>[0]['shape'],
      error: new TRPCError({ code: 'FORBIDDEN' }),
      type: 'mutation',
      path: 'auth.login',
      input: undefined,
      ctx: undefined,
    });
    expect(shaped.data.appCode).toBe(AppErrorCode.FORBIDDEN);
  });
});
