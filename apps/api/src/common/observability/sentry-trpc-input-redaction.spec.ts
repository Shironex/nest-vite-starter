/**
 * No Sentry event may carry a batched tRPC input or an identifier query value.
 * An API error raised while serving the web's batched tRPC GET has the target
 * `/api/trpc/<procs>?batch=1&input=<JSON of every procedure input>`, so a
 * scrubber that blanked only named query keys would ship record ids and
 * free-text search terms in `request.url` and `request.query_string`.
 *
 * `sentry-scrub.spec.ts` calls `scrubEvent` directly, so it stays green if
 * `instrument.ts` stops handing the scrubber to `Sentry.init`. This file loads
 * the real `instrument.ts` with a DSN set and drives the `beforeSend` it
 * registered, so it goes red on either break.
 */
interface ISentryInitOptions {
  beforeSend?: (event: Record<string, unknown>) => Record<string, unknown> | null;
}

const mockSentryInits: ISentryInitOptions[] = [];

jest.mock('@sentry/nestjs', () => ({
  init: jest.fn((options: ISentryInitOptions) => {
    mockSentryInits.push(options);
  }),
  close: jest.fn(() => Promise.resolve(true)),
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

let onceSpy: jest.SpyInstance;

beforeAll(async () => {
  // A DSN registers the SIGTERM/SIGINT drain; keep it off the test process.
  onceSpy = jest.spyOn(process, 'once').mockImplementation(() => process);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  process.env.SENTRY_DSN = 'https://public@sentry.invalid/1';
  // Imported only now: instrument.ts reads the DSN once, at module load.
  await import('../../instrument');
  const registered = mockSentryInits[0]?.beforeSend;
  if (!registered) throw new Error('instrument.ts did not register a beforeSend with Sentry.init');
  beforeSend = registered;
});

afterAll(() => {
  delete process.env.SENTRY_DSN;
  onceSpy.mockRestore();
  jest.restoreAllMocks();
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

describe('no Sentry event carries a batched tRPC input or an identifier query value', () => {
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
