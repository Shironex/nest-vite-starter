import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The facade is off by default and gates on VITE_SENTRY_DSN,
 * so these tests are the only proof that (a) the SDK is never loaded or
 * called when disabled, (b) the enabled path wires the conservative init
 * config and the scrubbers, and (c) the scrub functions redact sensitive
 * keys without the SDK present.
 *
 * Each test re-imports the module after resetModules so the module-level
 * sdk/initPromise state starts empty (mirrors csrf.test.ts).
 */

// Shared spies: vi.hoisted keeps one object across resetModules so the
// dynamically imported '@sentry/react' mock always resolves to these.
const sentryMock = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock('@sentry/react', () => sentryMock);

type ErrorReportingModule = typeof import('./error-reporting');

async function importFacade(): Promise<ErrorReportingModule> {
  return import('./error-reporting');
}

describe('error-reporting facade', () => {
  beforeEach(() => {
    vi.resetModules();
    sentryMock.init.mockClear();
    sentryMock.captureException.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is a no-op by default (no VITE_SENTRY_DSN)', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '');
    const { initErrorReporting, captureException } = await importFacade();

    await initErrorReporting();
    captureException(new Error('boom'));
    // Flush the microtask queue so a queued capture (if any) would have fired.
    await Promise.resolve();

    expect(sentryMock.init).not.toHaveBeenCalled();
    expect(sentryMock.captureException).not.toHaveBeenCalled();
  });

  it('captureException without init never throws and never touches the SDK', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://key@o0.ingest.sentry.io/0');
    const { captureException } = await importFacade();

    expect(() => captureException(new Error('early'))).not.toThrow();
    await Promise.resolve();
    expect(sentryMock.captureException).not.toHaveBeenCalled();
  });

  it('initializes the SDK with a conservative, scrubbing config when enabled', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://key@o0.ingest.sentry.io/0');
    const { initErrorReporting } = await importFacade();

    await initErrorReporting();

    expect(sentryMock.init).toHaveBeenCalledTimes(1);
    const options = sentryMock.init.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options).toMatchObject({
      dsn: 'https://key@o0.ingest.sentry.io/0',
      sendDefaultPii: false,
      tracesSampleRate: 0,
      environment: import.meta.env.MODE,
    });

    // The wired hooks must actually scrub.
    const beforeSend = options.beforeSend as (e: object) => { extra?: Record<string, unknown> };
    expect(beforeSend({ extra: { password: 'hunter2' } })).toEqual({
      extra: { password: '[REDACTED]' },
    });
    const beforeBreadcrumb = options.beforeBreadcrumb as (b: object) => { message?: string };
    expect(beforeBreadcrumb({ message: 'refresh token expired' }).message).toBe('[REDACTED]');
  });

  it('is idempotent: repeated init calls configure the SDK once', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://key@o0.ingest.sentry.io/0');
    const { initErrorReporting } = await importFacade();

    await Promise.all([initErrorReporting(), initErrorReporting()]);
    await initErrorReporting();

    expect(sentryMock.init).toHaveBeenCalledTimes(1);
  });

  it('forwards captureException with context after init', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://key@o0.ingest.sentry.io/0');
    const { initErrorReporting, captureException } = await importFacade();

    await initErrorReporting();
    const error = new Error('boom');
    captureException(error, { extra: { queryKey: ['user', 'me'] } });

    expect(sentryMock.captureException).toHaveBeenCalledWith(error, {
      extra: { queryKey: ['user', 'me'] },
    });
  });

  it('queues a capture fired while init is still in flight', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://key@o0.ingest.sentry.io/0');
    const { initErrorReporting, captureException } = await importFacade();

    const initInFlight = initErrorReporting();
    const error = new Error('raced');
    captureException(error);
    expect(sentryMock.captureException).not.toHaveBeenCalled();

    await initInFlight;
    await Promise.resolve();
    expect(sentryMock.captureException).toHaveBeenCalledWith(error, undefined);
  });
});

describe('scrubEvent', () => {
  it('redacts sensitive keys in extra, contexts, and request, including nested objects', async () => {
    const { scrubEvent } = await importFacade();
    const event = {
      extra: {
        queryKey: ['user', 'me'],
        accessToken: 'abc123',
        nested: { userEmail: 'jane@example.com', ok: 'keep' },
      },
      contexts: { session: { sessionId: 's-1', device: 'mac' } },
      request: { headers: { cookie: 'sid=1', accept: 'application/json' } },
    };

    const out = scrubEvent(event);

    expect(out.extra).toEqual({
      queryKey: ['user', 'me'],
      accessToken: '[REDACTED]',
      nested: { userEmail: '[REDACTED]', ok: 'keep' },
    });
    expect(out.contexts).toEqual({ session: { sessionId: '[REDACTED]', device: 'mac' } });
    expect(out.request).toEqual({
      headers: { cookie: '[REDACTED]', accept: 'application/json' },
    });
  });

  it('is pure: the input event is not mutated', async () => {
    const { scrubEvent } = await importFacade();
    const event = { extra: { password: 'hunter2' } };

    scrubEvent(event);

    expect(event.extra.password).toBe('hunter2');
  });

  it('passes through events without scrubbable sections', async () => {
    const { scrubEvent } = await importFacade();
    expect(scrubEvent({})).toEqual({});
  });
});

/**
 * Third-party egress, NOT first-party logging.
 *
 * SENSITIVE_KEY_PATTERNS deliberately permits `userId` (the api
 * audit trail already stores it raw in a queryable column, so denying it
 * in our own NDJSON defends nothing the database does not hold). That argument
 * is first-party only - what our database holds says nothing about what a
 * third party should receive - so this boundary denies it again locally, the
 * same way apps/api/src/common/observability/sentry-scrub.ts does.
 *
 * These assertions are the defense the api boundary already had and this one
 * did not, which is why the A8 change broke the api build and landed silently
 * here. Deleting them re-opens the leak in silence.
 */
describe('scrubEvent: identifiers denied at the Sentry boundary only', () => {
  it('redacts userId in extra, contexts, tags and request, including compound names', async () => {
    const { scrubEvent } = await importFacade();

    const out = scrubEvent({
      // Shape the app actually ships: a failed tRPC query forwards its
      // queryKey, which carries the procedure input verbatim (lib/trpc.ts).
      extra: {
        queryKey: [['audit', 'list'], { input: { userId: 'usr_12345', limit: 20 } }],
      },
      contexts: { app: { userId: 'usr_12345' } },
      tags: { userId: 'usr_12345' },
      request: { data: { actorUserId: 'usr_12345', target_user_id: 'usr_12345' } },
    });

    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('usr_12345');
    expect(out.extra).toEqual({
      queryKey: [['audit', 'list'], { input: { userId: '[REDACTED]', limit: 20 } }],
    });
    expect(out.contexts).toEqual({ app: { userId: '[REDACTED]' } });
    expect(out.tags).toEqual({ userId: '[REDACTED]' });
    expect(out.request).toEqual({
      data: { actorUserId: '[REDACTED]', target_user_id: '[REDACTED]' },
    });
  });

  it('keeps record identifiers, which name no person and carry the triage', async () => {
    const { scrubEvent } = await importFacade();

    const out = scrubEvent({
      extra: { jobId: 'job_1', documentId: 'doc_1', status: 404 },
    });

    expect(out.extra).toEqual({
      jobId: 'job_1',
      documentId: 'doc_1',
      status: 404,
    });
  });
});

/**
 * Credentials carried INSIDE strings, which key-based redaction cannot see.
 *
 * Sentry's browser SDK attaches `event.request.url` from
 * `document.location.href` (its httpContext integration) and records
 * navigation / fetch breadcrumbs whose `data` holds URL strings. Four web
 * routes take a single-use credential as a search param and one takes it as a
 * path segment, so an error thrown on any of them shipped a redeemable
 * credential to a third party verbatim until these assertions existed.
 *
 * The route itself must survive: "which page broke" is the whole triage value
 * of `request.url`, so only the credential is blanked.
 */
describe('scrubEvent: credentials inside URL strings', () => {
  const CREDENTIAL_URLS: Array<[string, string, string]> = [
    [
      'reset-password',
      'https://app.example.com/auth/reset-password?token=rst_live_abcdef',
      'https://app.example.com/auth/reset-password?token=[REDACTED]',
    ],
    [
      'verify-email',
      'https://app.example.com/auth/verify-email?token=vrf_live_abcdef',
      'https://app.example.com/auth/verify-email?token=[REDACTED]',
    ],
    [
      'confirm-email-change',
      'https://app.example.com/auth/confirm-email-change?token=cec_live_abcdef',
      'https://app.example.com/auth/confirm-email-change?token=[REDACTED]',
    ],
    [
      'auth/invite (staff invite, same path-segment shape)',
      'https://app.example.com/auth/invite/stf_live_abcdef',
      'https://app.example.com/auth/invite/[REDACTED]',
    ],
  ];

  it.each(CREDENTIAL_URLS)(
    'blanks the credential in %s and keeps the route',
    async (_name, url, expected) => {
      const { scrubEvent } = await importFacade();

      const out = scrubEvent({ request: { url } });

      expect(out.request).toEqual({ url: expected });
    },
  );

  it('blanks the credential in the Referer header, not just the url', async () => {
    const { scrubEvent } = await importFacade();

    const out = scrubEvent({
      request: {
        url: 'https://app.example.com/auth/login',
        headers: { Referer: 'https://app.example.com/auth/reset-password?token=rst_live_abcdef' },
      },
    });

    expect(JSON.stringify(out)).not.toContain('rst_live_abcdef');
  });

  it('blanks identifiers carried as search params, matching the key-based rule', async () => {
    const { scrubEvent } = await importFacade();

    const out = scrubEvent({
      request: { url: 'https://app.example.com/settings?user_id=usr_2&userId=usr_1&part=B' },
    });

    expect(out.request).toEqual({
      url: 'https://app.example.com/settings?user_id=[REDACTED]&userId=[REDACTED]&part=B',
    });
  });

  it('blanks credentials quoted in the message and the exception text', async () => {
    const { scrubEvent } = await importFacade();

    const out = scrubEvent({
      message: 'navigation to https://app.example.com/auth/invite/inv_live_abcdef failed',
      exception: {
        values: [
          {
            type: 'TypeError',
            value: 'Failed to fetch /api/auth/reset-password?token=rst_live_abcdef',
          },
        ],
      },
    });

    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('rst_live_abcdef');
    expect(serialized).not.toContain('inv_live_abcdef');
    // The surrounding text, and every other field on the exception, survive.
    expect(out.exception?.values?.[0]).toEqual({
      type: 'TypeError',
      value: 'Failed to fetch /api/auth/reset-password?token=[REDACTED]',
    });
    expect(out.message).toBe('navigation to https://app.example.com/auth/invite/[REDACTED] failed');
  });

  it('leaves ordinary search params alone', async () => {
    const { scrubEvent } = await importFacade();

    const out = scrubEvent({
      request: { url: 'https://app.example.com/auth/login?redirect=/dashboard&settled=true' },
    });

    expect(out.request).toEqual({
      url: 'https://app.example.com/auth/login?redirect=/dashboard&settled=true',
    });
  });
});

describe('scrubBreadcrumb', () => {
  it('redacts sensitive keys in data', async () => {
    const { scrubBreadcrumb } = await importFacade();
    const out = scrubBreadcrumb({
      message: 'navigation',
      data: { url: '/settings', csrfToken: 'tok', meta: { phone: '123' } },
    });

    expect(out.data).toEqual({
      url: '/settings',
      csrfToken: '[REDACTED]',
      meta: { phone: '[REDACTED]' },
    });
    expect(out.message).toBe('navigation');
  });

  // Same boundary rule as the scrubEvent block above: the shared log denylist
  // permits these, external egress does not.
  it('redacts user identifiers in data, including compound names', async () => {
    const { scrubBreadcrumb } = await importFacade();
    const out = scrubBreadcrumb({
      message: 'fetch',
      data: { url: '/api/trpc/audit.list', userId: 'usr_1', meta: { actorUserId: 'usr_9' } },
    });

    expect(JSON.stringify(out)).not.toContain('usr_1');
    expect(out.data).toEqual({
      url: '/api/trpc/audit.list',
      userId: '[REDACTED]',
      meta: { actorUserId: '[REDACTED]' },
    });
  });

  // A navigation breadcrumb records where the user came FROM, so it carries
  // the credential-bearing URL even on an error raised two pages later.
  it('blanks credentials in navigation and fetch breadcrumb URLs', async () => {
    const { scrubBreadcrumb } = await importFacade();

    const navigation = scrubBreadcrumb({
      data: {
        from: 'https://app.example.com/auth/reset-password?token=rst_live_abcdef',
        to: 'https://app.example.com/auth/verify-email?token=vrf_live_abcdef',
      },
    });

    expect(navigation.data).toEqual({
      from: 'https://app.example.com/auth/reset-password?token=[REDACTED]',
      to: 'https://app.example.com/auth/verify-email?token=[REDACTED]',
    });

    const fetched = scrubBreadcrumb({
      data: { url: '/api/auth/reset-password?token=rst_live_abcdef', status_code: 400 },
    });

    expect(fetched.data).toEqual({
      url: '/api/auth/reset-password?token=[REDACTED]',
      status_code: 400,
    });
  });

  // The staff invite (/auth/invite/$token) carries a redeemable credential in
  // the path, and an invitee lands on it
  // straight from the mail client, so the navigation breadcrumb that records
  // the arrival is the first thing a later error ships out.
  it('blanks the staff invite token in a navigation breadcrumb', async () => {
    const { scrubBreadcrumb } = await importFacade();

    const navigation = scrubBreadcrumb({
      message: 'navigation',
      data: {
        from: 'https://app.example.com/auth/login',
        to: 'https://app.example.com/auth/invite/stf_live_abcdef',
      },
    });

    expect(navigation.data).toEqual({
      from: 'https://app.example.com/auth/login',
      to: 'https://app.example.com/auth/invite/[REDACTED]',
    });
  });

  // The httpBatchLink sends every tRPC query as a GET whose `input` param is
  // the JSON of every batched procedure input: person ids, and free-text
  // search terms that are somebody's surname.
  it('blanks the tRPC batch input param and keeps the procedure path', async () => {
    const { scrubBreadcrumb } = await importFacade();

    const batched = scrubBreadcrumb({
      category: 'fetch',
      data: {
        url:
          '/api/trpc/user.listUsers,audit.list?batch=1&input=' +
          encodeURIComponent('{"0":{"json":{"search":"Kowalski","userId":"usr_9"}}}'),
        status_code: 500,
      },
    });

    const url = (batched.data as { url: string }).url;

    expect(url).toBe('/api/trpc/user.listUsers,audit.list?batch=1&input=[REDACTED]');
    expect(url).not.toContain('Kowalski');
    expect(url).not.toContain('usr_9');
  });

  it('drops message content that mentions a sensitive key name', async () => {
    const { scrubBreadcrumb } = await importFacade();
    expect(scrubBreadcrumb({ message: 'refresh token expired: abc' }).message).toBe('[REDACTED]');
    expect(scrubBreadcrumb({ message: 'user email set to x@y.z' }).message).toBe('[REDACTED]');
  });

  it('is pure: the input breadcrumb is not mutated', async () => {
    const { scrubBreadcrumb } = await importFacade();
    const breadcrumb = { message: 'password reset requested', data: { secret: 's' } };

    scrubBreadcrumb(breadcrumb);

    expect(breadcrumb.message).toBe('password reset requested');
    expect(breadcrumb.data.secret).toBe('s');
  });
});
