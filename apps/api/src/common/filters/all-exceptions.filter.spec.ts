import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

// Suppress output during tests, but keep the error line inspectable: what the
// filter logs is the only record of a non-HttpException's real message once the
// client-facing one has been replaced with the generic string.
const loggerErrorMock = jest.fn();
const loggerWarnMock = jest.fn();
jest.mock('../../modules/logger/logger.service', () => ({
  createAppLogger: () => ({
    error: (...args: unknown[]) => loggerErrorMock(...args),
    warn: (...args: unknown[]) => loggerWarnMock(...args),
    info: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(),
  }),
}));

const captureExceptionMock = jest.fn();
jest.mock('@sentry/nestjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

import { AllExceptionsFilter } from './all-exceptions.filter';

function createMockHost() {
  const jsonFn = jest.fn();
  const statusFn = jest.fn().mockReturnValue({ json: jsonFn });
  const mockResponse = { status: statusFn };
  const mockRequest = { method: 'GET', path: '/test-path', url: '/test-path' };

  const host = {
    switchToHttp: () => ({
      getResponse: () => mockResponse,
      getRequest: () => mockRequest,
    }),
  } as unknown as ArgumentsHost;

  return { host, statusFn, jsonFn, mockRequest };
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let configService: ConfigService;

  beforeEach(async () => {
    captureExceptionMock.mockReset();
    loggerErrorMock.mockReset();
    loggerWarnMock.mockReset();
    const module = await Test.createTestingModule({
      providers: [
        AllExceptionsFilter,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('development'),
          },
        },
      ],
    }).compile();

    filter = module.get(AllExceptionsFilter);
    configService = module.get(ConfigService);
  });

  describe('HTTP exceptions', () => {
    it('should format an HttpException with its status and message', () => {
      const { host, statusFn, jsonFn } = createMockHost();
      const exception = new HttpException('Not Found', HttpStatus.NOT_FOUND);

      filter.catch(exception, host);

      expect(statusFn).toHaveBeenCalledWith(404);
      const responseBody = jsonFn.mock.calls[0][0];
      expect(responseBody.error.message).toBe('Not Found');
      expect(responseBody.error.code).toBe(404);
    });

    it('should include stack trace in development mode', () => {
      const { host, jsonFn } = createMockHost();
      const exception = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);

      filter.catch(exception, host);

      const responseBody = jsonFn.mock.calls[0][0];
      expect(responseBody.error.stack).toBeDefined();
      expect(responseBody.error.path).toBe('/test-path');
    });

    it('should hide stack trace in production mode', () => {
      // Switch to production mode
      (configService.get as jest.Mock).mockReturnValue('production');

      const { host, jsonFn } = createMockHost();
      const exception = new HttpException('Forbidden', HttpStatus.FORBIDDEN);

      filter.catch(exception, host);

      const responseBody = jsonFn.mock.calls[0][0];
      expect(responseBody.error.message).toBe('Forbidden');
      expect(responseBody.error.code).toBe(403);
      expect(responseBody.error.stack).toBeUndefined();
      expect(responseBody.error.path).toBeUndefined();
    });
  });

  /**
   * http-errors objects (body-parser, express, several middlewares) are not
   * HttpExceptions and not instances of anything Nest recognizes, so before
   * this branch existed every one of them was answered as a 500, logged at
   * ERROR and captured to Sentry. An anonymous over-cap POST to any path was
   * therefore a free Sentry event.
   *
   * The fixtures are built by hand rather than imported from `http-errors`:
   * the filter matches the SHAPE on purpose (`expose` + a 4xx `status`), not a
   * constructor, and a hand-built object is the only way to assert that.
   */
  describe('http-errors client errors', () => {
    function httpError(status: number, message: string, expose: boolean): Error {
      return Object.assign(new Error(message), { status, statusCode: status, expose });
    }

    it('answers an exposed 4xx with its own status and message', () => {
      const { host, statusFn, jsonFn } = createMockHost();

      filter.catch(httpError(413, 'request entity too large', true), host);

      expect(statusFn).toHaveBeenCalledWith(413);
      const responseBody = jsonFn.mock.calls[0][0];
      expect(responseBody.error.code).toBe(413);
      expect(responseBody.error.message).toBe('request entity too large');
      expect(responseBody.error.appCode).toBe('PAYLOAD_TOO_LARGE');
    });

    it('logs an exposed 4xx at warn and never captures it', () => {
      const { host } = createMockHost();

      filter.catch(httpError(413, 'request entity too large', true), host);

      expect(loggerErrorMock).not.toHaveBeenCalled();
      expect(captureExceptionMock).not.toHaveBeenCalled();
      expect(loggerWarnMock).toHaveBeenCalledWith(
        'Unhandled exception',
        expect.objectContaining({ statusCode: 413 }),
      );
    });

    it('keeps an UNEXPOSED error generic: expose is the only permission to speak', () => {
      // http-errors leaves `expose` false for anything it did not build for a
      // client. Trusting `status` alone would forward an internal message.
      const { host, statusFn, jsonFn } = createMockHost();

      filter.catch(httpError(403, 'secret key rotation failed', false), host);

      expect(statusFn).toHaveBeenCalledWith(500);
      expect(jsonFn.mock.calls[0][0].error.message).toBe('Internal server error');
    });

    it('never lets an exposed 5xx through as itself', () => {
      const { host, statusFn, jsonFn } = createMockHost();

      filter.catch(httpError(503, 'upstream pool exhausted', true), host);

      expect(statusFn).toHaveBeenCalledWith(500);
      expect(jsonFn.mock.calls[0][0].error.message).toBe('Internal server error');
      expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * The HTTP boundary names its failures the same way the tRPC boundary does,
   * so a client can switch on `appCode` instead of on a numeric status or a
   * message string.
   */
  describe('appCode', () => {
    it.each([
      [400, 'VALIDATION_ERROR'],
      [401, 'UNAUTHORIZED'],
      [403, 'FORBIDDEN'],
      [404, 'NOT_FOUND'],
      [409, 'CONFLICT'],
      [413, 'PAYLOAD_TOO_LARGE'],
      [429, 'RATE_LIMITED'],
      [500, 'INTERNAL_ERROR'],
      [502, 'INTERNAL_ERROR'],
    ])('names a %s as %s', (status, expected) => {
      const { host, jsonFn } = createMockHost();

      filter.catch(new HttpException('boom', status), host);

      expect(jsonFn.mock.calls[0][0].error.appCode).toBe(expected);
    });

    it('omits appCode for a status with no faithful code rather than guessing', () => {
      // An absent field is a client falling back to the status; a wrong one is
      // a client acting on a lie.
      const { host, jsonFn } = createMockHost();

      filter.catch(new HttpException('Unsupported Media Type', 415), host);

      expect(jsonFn.mock.calls[0][0].error.appCode).toBeUndefined();
    });
  });

  describe('unknown exceptions', () => {
    it('should return 500 for non-HttpException errors', () => {
      const { host, statusFn, jsonFn } = createMockHost();
      const exception = new Error('Something broke');

      filter.catch(exception, host);

      expect(statusFn).toHaveBeenCalledWith(500);
      const responseBody = jsonFn.mock.calls[0][0];
      expect(responseBody.error.message).toBe('Internal server error');
      expect(responseBody.error.code).toBe(500);
    });

    it('should return 500 for non-Error thrown values', () => {
      const { host, statusFn, jsonFn } = createMockHost();

      filter.catch('some string error', host);

      expect(statusFn).toHaveBeenCalledWith(500);
      const responseBody = jsonFn.mock.calls[0][0];
      expect(responseBody.error.message).toBe('Internal server error');
      expect(responseBody.error.code).toBe(500);
      // Non-Error values have no stack to include
      expect(responseBody.error.stack).toBeUndefined();
    });

    it('should include stack for non-Http Error in dev mode', () => {
      const { host, jsonFn } = createMockHost();
      const exception = new Error('Unexpected failure');

      filter.catch(exception, host);

      const responseBody = jsonFn.mock.calls[0][0];
      expect(responseBody.error.stack).toBeDefined();
      expect(responseBody.error.path).toBe('/test-path');
    });
  });

  describe('error logging', () => {
    it('logs the real message and stack even though the client gets the generic one', () => {
      const { host, jsonFn } = createMockHost();
      const exception = new Error('User u-42 has a corrupt totpSecretEnc column');

      filter.catch(exception, host);

      // The client is told nothing.
      expect(jsonFn.mock.calls[0][0].error.message).toBe('Internal server error');

      // The operator is told everything. An Error's own properties are
      // non-enumerable, so without normalizing it this field would be `{}`.
      const data = loggerErrorMock.mock.calls[0][1] as { err: Record<string, unknown> };
      expect(data.err.name).toBe('Error');
      expect(data.err.message).toBe('User u-42 has a corrupt totpSecretEnc column');
      expect(String(data.err.stack)).toContain('User u-42');
      expect(JSON.stringify(data.err)).not.toBe('{}');
    });

    it('gathers userId for triage', () => {
      const { host } = createMockHost();

      filter.catch(new Error('boom'), host);

      // Present as a key (undefined here, since no ALS store is open). The
      // redactor treats userId as an identifier, so triage can answer "which
      // account is hitting this 500".
      const data = loggerErrorMock.mock.calls[0][1] as Record<string, unknown>;
      expect(Object.keys(data)).toContain('userId');
    });

    it('logs the path without its query string', () => {
      // The throttler and the unknown-provider 404 reach this filter for
      // `GET /api/auth/oauth/google/callback?code=...&state=...`, and the
      // batched tRPC GET carries `?input=<JSON of every procedure input>`.
      // `redactSensitive` is key-based, so a string called `path` would be
      // emitted verbatim.
      const { host, mockRequest } = createMockHost();
      Object.assign(mockRequest, {
        path: '/api/auth/oauth/google/callback',
        url: '/api/auth/oauth/google/callback?code=4/0AbCdEf&state=deadbeef',
      });

      filter.catch(new Error('boom'), host);

      const data = loggerErrorMock.mock.calls[0][1] as Record<string, unknown>;
      expect(data.path).toBe('/api/auth/oauth/google/callback');
      expect(JSON.stringify(data)).not.toContain('4/0AbCdEf');
      expect(JSON.stringify(data)).not.toContain('deadbeef');
    });

    it('logs a client-caused 4xx at warn, not error', () => {
      // A scanner walking 404s or a throttled client would otherwise fill the
      // ERROR stream with stacks and make an ERROR-rate alert on the HTTP
      // surface untrustworthy. LoggerMiddleware already records the request.
      const { host } = createMockHost();

      filter.catch(new HttpException('Not Found', HttpStatus.NOT_FOUND), host);

      expect(loggerErrorMock).not.toHaveBeenCalled();
      expect(loggerWarnMock).toHaveBeenCalledWith(
        'Unhandled exception',
        expect.objectContaining({ statusCode: 404 }),
      );
    });

    it('keeps 5xx at error', () => {
      const { host } = createMockHost();

      filter.catch(new HttpException('Bad gateway', HttpStatus.BAD_GATEWAY), host);

      expect(loggerWarnMock).not.toHaveBeenCalled();
      expect(loggerErrorMock).toHaveBeenCalledWith(
        'Unhandled exception',
        expect.objectContaining({ statusCode: 502 }),
      );
    });

    it('records a non-Error thrown value as-is rather than inventing a stack', () => {
      const { host } = createMockHost();

      filter.catch('some string error', host);

      const data = loggerErrorMock.mock.calls[0][1] as Record<string, unknown>;
      expect(data.err).toBe('some string error');
    });
  });

  describe('Sentry capture', () => {
    it('captures 5xx responses with request context', () => {
      const { host } = createMockHost();
      const exception = new Error('Something broke');

      filter.catch(exception, host);

      expect(captureExceptionMock).toHaveBeenCalledTimes(1);
      expect(captureExceptionMock).toHaveBeenCalledWith(exception, {
        extra: expect.objectContaining({
          statusCode: 500,
          path: '/test-path',
          method: 'GET',
        }),
      });
    });

    it('captures an explicit 5xx HttpException', () => {
      const { host } = createMockHost();
      const exception = new HttpException('Bad gateway', HttpStatus.BAD_GATEWAY);

      filter.catch(exception, host);

      expect(captureExceptionMock).toHaveBeenCalledWith(
        exception,
        expect.objectContaining({ extra: expect.objectContaining({ statusCode: 502 }) }),
      );
    });

    it('does NOT capture 4xx client errors', () => {
      const { host } = createMockHost();

      filter.catch(new HttpException('Not Found', HttpStatus.NOT_FOUND), host);
      filter.catch(new HttpException('Bad Request', HttpStatus.BAD_REQUEST), host);

      expect(captureExceptionMock).not.toHaveBeenCalled();
    });
  });
});
