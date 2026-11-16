/**
 * SEC-006: an API error raised while serving the web's batched
 * tRPC GET shipped the procedure inputs to Sentry. The target is
 * `/api/trpc/<procs>?batch=1&input=<JSON of every procedure input>`, and the
 * API scrubber blanked only named OAuth query keys, so `request.url` and
 * `request.query_string` left the process with record ids and free-text
 * search terms (a surname) intact. The web Sentry boundary already denied
 * `input=` and the identifier keys in query form; the API one did not.
 *
 * Fixed in `sentry-scrub.ts`, which now denies `input` and
 * the egress identifier keys in query-string form, the same list as the web's
 * `IDENTIFIER_QUERY_KEYS`.
 *
 * Why this lives here and not only in `sentry-scrub.spec.ts`: that spec calls
 * `scrubEvent` directly, so it stays green if `otel.ts` stops handing the
 * scrubber to `Sentry.init`. This file loads the real `otel.ts` with a DSN set
 * and drives the `beforeSend` it registered, so it goes red on either break.
 * No database.
 */
interface ISentryInitOptions {
  beforeSend?: (event: Record<string, unknown>) => Record<string, unknown> | null;
}

const mockSentryInits: ISentryInitOptions[] = [];

jest.mock('@sentry/nestjs', () => ({
  init: jest.fn((options: ISentryInitOptions) => {
    mockSentryInits.push(options);
  }),
  onUnhandledRejectionIntegration: jest.fn(() => ({ name: 'OnUnhandledRejection' })),
}));

const SEARCH_TERM = 'DoeInputSentinel';
const RECORD_ID = 'rec_inputSentinel9';
const USER_ID = 'usr_querySentinel4';
const TRPC_INPUT = encodeURIComponent(
  JSON.stringify({ 0: { search: SEARCH_TERM }, 1: { recordId: RECORD_ID } }),
);
const PROCEDURES = '/api/trpc/user.list,user.get';

let beforeSend: NonNullable<ISentryInitOptions['beforeSend']>;

beforeAll(async () => {
  process.env.SENTRY_DSN = 'https://public@sentry.invalid/1';
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  // Imported only now: otel.ts reads the DSN once, at module load.
  await import('@/otel');
  const registered = mockSentryInits[0]?.beforeSend;
  if (!registered) throw new Error('otel.ts did not register a beforeSend with Sentry.init');
  beforeSend = registered;
});

afterAll(() => {
  delete process.env.SENTRY_DSN;
});

/** A fresh event per case: the scrubber rewrites in place. */
function trpcBatchEvent(): Record<string, unknown> {
  return {
    message: `GET /api/users?userId=${USER_ID}&page=2 failed`,
    request: {
      method: 'GET',
      url: `https://api.example${PROCEDURES}?batch=1&input=${TRPC_INPUT}`,
      query_string: `batch=1&input=${TRPC_INPUT}`,
    },
  };
}

function expectNoProcedureInput(event: Record<string, unknown> | null): void {
  const serialized = JSON.stringify(event);
  for (const sentinel of [SEARCH_TERM, RECORD_ID, USER_ID]) {
    expect(serialized).not.toContain(sentinel);
  }
}

describe('SEC-006 no Sentry event carries a batched tRPC input or an identifier query value', () => {
  it('control: the registered beforeSend keeps the procedure path and the batch flag', () => {
    const event = beforeSend(trpcBatchEvent());
    const request = event?.request as { url: string; query_string: string } | undefined;
    expect(request?.url).toContain(`${PROCEDURES}?batch=1&input=`);
    expect(request?.query_string).toContain('batch=1&input=');
  });

  it('request.url, request.query_string and the message leave with no procedure input', () => {
    expectNoProcedureInput(beforeSend(trpcBatchEvent()));
  });
});
