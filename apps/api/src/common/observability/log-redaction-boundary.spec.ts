/**
 * Log redaction fails closed at every boundary. A walker that redacted by key
 * NAME only, returned a whole subtree unredacted once it passed the depth cap,
 * and never looked at message strings would write a secret interpolated into a
 * line, or buried deep in a payload, verbatim to both sinks.
 *
 * The end-to-end sentinel run over both sinks lives in
 * `packages/shared/src/logger/redaction-boundary.test.ts`; what is pinned here
 * is the shape of that failure, plus the api call site (the tRPC error handler)
 * that must keep raw error text out of the log message.
 */
import { AppErrorCode } from '@repo/shared/errors';
import { redactSensitive, scrubText } from '@repo/shared/logger';
import { AppErrorHandler } from '../../trpc/trpc.error-handler';

const errorMock = jest.fn();
const warnMock = jest.fn();

// The handler builds its logger at import time, so the sink has to be in place
// before that import runs. `@swc/jest` hoists these two calls above it, exactly
// as babel-jest does.
jest.mock('../../modules/logger/logger.service', () => ({
  createAppLogger: () => ({
    error: (...args: unknown[]) => errorMock(...args),
    warn: (...args: unknown[]) => warnMock(...args),
    info: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

/**
 * Sentinels: each one is a secret SHAPE, not a secret key name. A key-name
 * redactor cannot see any of them, which is the half of the failure that made
 * "redact by key" insufficient.
 */
// Built from parts at runtime so the source never carries a literal that a
// secret scanner reads as a real credential.
const b64 = (text: string): string => Buffer.from(text).toString('base64url');
const ARGON2 = [
  '',
  'argon2id',
  'v=19',
  'm=65536,t=3,p=4',
  b64('sentinelsalt'),
  b64('sentinelhash'.repeat(2)),
].join('$');
const BEARER = ['sk', 'live', 'sentinel' + 'Bearer' + 'Value'].join('_');
const JWT = [
  b64('{"alg":"HS256"}'),
  b64('{"sub":"sentinel-user"}'),
  b64('sentinelsignature_value'),
].join('.');
const EMAIL = 'sentinel.person@example.com';
const SENTINELS = [ARGON2, BEARER, JWT, EMAIL];

const SENTINEL_TEXT = `login for ${EMAIL} with hash ${ARGON2}, header Bearer ${BEARER}, jwt ${JWT}`;

/** A payload deeper than the walker's cap, with a secret at the bottom. */
function deepSubtree(): Record<string, unknown> {
  let node: Record<string, unknown> = { hash: ARGON2, note: SENTINEL_TEXT };
  for (let level = 0; level < 12; level += 1) {
    node = { level, child: node };
  }
  return node;
}

const serialize = (value: unknown): string => JSON.stringify(value);

const expectNoSentinel = (text: string): void => {
  for (const sentinel of SENTINELS) {
    expect(text).not.toContain(sentinel);
  }
};

/** The options the tRPC server hands the error handler. */
const buildOpts = (error: { code: string; message: string; cause?: unknown }) =>
  ({
    error: error as unknown as Parameters<AppErrorHandler['onError']>[0]['error'],
    type: 'mutation' as const,
    path: 'auth.login',
    input: undefined,
    ctx: {},
    req: undefined,
  }) as unknown as Parameters<AppErrorHandler['onError']>[0];

beforeEach(() => {
  errorMock.mockClear();
  warnMock.mockClear();
});

describe('log redaction fails closed at every boundary', () => {
  it('control: correlation fields and ordinary context still come through', () => {
    // Without this, every assertion below would also pass against a redactor
    // that replaced the entire payload, which would delete the operator's only
    // way to correlate a line with a request.
    const redacted = redactSensitive({
      requestId: 'req-7c2f',
      route: '/trpc/auth.login',
      userId: 'user-control-1',
      statusCode: 500,
    });

    expect(redacted).toEqual({
      requestId: 'req-7c2f',
      route: '/trpc/auth.login',
      userId: 'user-control-1',
      statusCode: 500,
    });
  });

  it('replaces a subtree past the depth cap instead of returning it', () => {
    // The fail-open half: past the cap the walker used to hand the raw value
    // back, so anything deep enough was never redacted at all.
    expectNoSentinel(serialize(redactSensitive(deepSubtree())));
  });

  it('scrubs secret shapes out of free text, which no key name describes', () => {
    expectNoSentinel(scrubText(SENTINEL_TEXT));
  });

  it('scrubs a string leaf whose key looks innocent', () => {
    expectNoSentinel(serialize(redactSensitive({ note: SENTINEL_TEXT, comment: SENTINEL_TEXT })));
  });

  it('keeps raw error text out of the tRPC log MESSAGE, on a data field instead', () => {
    // The api-side half. A message string is never walked by the redactor, so
    // interpolating the error into it defeated everything above; it now rides
    // `errorMessage`, which is.
    new AppErrorHandler().onError(
      buildOpts({ code: 'INTERNAL_SERVER_ERROR', message: SENTINEL_TEXT }),
    );

    const [message, data] = errorMock.mock.calls[0] ?? [];
    expect(message).toBe(`tRPC error [mutation] auth.login (${AppErrorCode.INTERNAL_ERROR})`);
    expectNoSentinel(String(message));
    expect(data).toEqual({ errorMessage: SENTINEL_TEXT });
    // And what the redactor does with that field is the assertion above.
    expectNoSentinel(serialize(redactSensitive(data)));
  });
});
