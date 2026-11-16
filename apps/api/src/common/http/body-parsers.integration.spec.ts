import type { Server } from 'node:http';

// The filter is the other half of the behavior under test: what a client sees
// for an over-cap body is decided by the parser AND by how the filter reads the
// http-errors object the parser throws. Both mocks mirror
// filters/all-exceptions.filter.spec.ts so this spec can assert the log level
// and the (absent) Sentry capture end to end, not just the status code.
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

import { Body, Controller, Module, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppErrorCode } from '@repo/shared/errors';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter';
import { JSON_BODY_LIMIT, configureBodyParsers } from './body-parsers';

@Controller()
class EchoController {
  @Post('echo')
  echo(@Body() body: unknown): { parsedAs: string } {
    return { parsedAs: typeof body };
  }
}

@Module({ controllers: [EchoController] })
class EchoModule {}

/** Every request here goes through one helper so none of them can hang. */
const REQUEST_TIMEOUT_MS = 10_000;

function post(url: string, contentType: string, body: string): ReturnType<typeof fetch> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/**
 * Boots a REAL http server with exactly the bootstrap main.ts performs for
 * bodies: `bodyParser: false`, then configureBodyParsers(), then the global
 * filter. Nothing here is faked, because the defect being pinned down was an
 * interaction (body-parser throws an object Nest does not recognize, and the
 * filter called it a 500) that no unit-level double reproduces.
 *
 * The over-cap payloads are VALID. A malformed body would get a 400 from
 * Nest's SyntaxError mapping and prove nothing about the cap; a valid body is the only one that can only fail for
 * being too big.
 */
describe('configureBodyParsers', () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  // Comfortably past the shared 100 kB cap, and small enough to stay fast.
  const OVER_CAP_BYTES = 200 * 1024;

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(EchoModule, {
      logger: false,
      bodyParser: false,
    });
    app.useGlobalFilters(new AllExceptionsFilter(new ConfigService({ NODE_ENV: 'test' })));
    configureBodyParsers(app);
    await app.listen(0, '127.0.0.1');

    const server: Server = app.getHttpServer();
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('expected a TCP address after listen(0)');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    loggerErrorMock.mockReset();
    loggerWarnMock.mockReset();
    captureExceptionMock.mockReset();
  });

  it('states the caps rather than inheriting them', () => {
    expect(JSON_BODY_LIMIT).toBe('100kb');
  });

  it('accepts an under-cap JSON body', async () => {
    const response = await post(
      `${baseUrl}/echo`,
      'application/json',
      JSON.stringify({ value: 'a'.repeat(1024) }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ parsedAs: 'object' });
  });

  it('answers an over-cap VALID JSON body with 413 and PAYLOAD_TOO_LARGE', async () => {
    const response = await post(
      `${baseUrl}/echo`,
      'application/json',
      JSON.stringify({ value: 'a'.repeat(OVER_CAP_BYTES) }),
    );

    expect(response.status).toBe(413);
    const payload: unknown = await response.json();
    expect(payload).toMatchObject({
      error: { code: 413, appCode: AppErrorCode.PAYLOAD_TOO_LARGE },
    });
  });

  it('answers an over-cap urlencoded body with 413 too', async () => {
    const response = await post(
      `${baseUrl}/echo`,
      'application/x-www-form-urlencoded',
      `value=${'a'.repeat(OVER_CAP_BYTES)}`,
    );

    expect(response.status).toBe(413);
  });

  // An unauthenticated client could otherwise raise an ERROR line and a Sentry
  // event on any path, for free, by posting 101 kB of anything.
  it('logs an over-cap body at warn and never captures it to Sentry', async () => {
    await post(
      `${baseUrl}/echo`,
      'application/json',
      JSON.stringify({ value: 'a'.repeat(OVER_CAP_BYTES) }),
    );

    expect(loggerErrorMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'Unhandled exception',
      expect.objectContaining({ statusCode: 413, appCode: AppErrorCode.PAYLOAD_TOO_LARGE }),
    );
  });

  // Nest maps body-parser's SyntaxError to a BadRequestException of its own, so
  // a malformed body 400s no matter what the cap is. Pinned here because it is
  // exactly the test that looked like cap coverage and was not.
  it('still answers malformed JSON with 400, which proves nothing about the cap', async () => {
    const response = await post(`${baseUrl}/echo`, 'application/json', '{"value": ');

    expect(response.status).toBe(400);
  });
});
