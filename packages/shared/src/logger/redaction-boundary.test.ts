import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from './index';

/**
 * The redaction boundary, asserted end to end through `createLogger`.
 *
 * Sentinels: each secret below is planted in every place a log line can carry
 * text (the message, a first-argument object, a positional Error's message and
 * stack, and a subtree too deep for the walker) and must appear in NO emitted
 * byte, on either persistent sink. The control proves the redactor did not get
 * there by emitting nothing: the correlation fields and ordinary context an
 * operator searches on still come through.
 */
const runtimeConsole = (
  globalThis as unknown as {
    console: { error: (...a: unknown[]) => void; log: (...a: unknown[]) => void };
  }
).console;

const PASSWORD = 'hunter2-sentinel-password';
const ARGON2 = '$argon2id$v=19$m=65536,t=3,p=4$c2VudGluZWxzYWx0$c2VudGluZWxoYXNoc2VudGluZWxoYXNo';
const BEARER_TOKEN = 'sk_live_sentinelBearerValue';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZW50aW5lbC11c2VyIn0.c2VudGluZWxzaWduYXR1cmVfdmFsdWU';
const EMAIL = 'sentinel.person@example.com';

const SENTINELS = [PASSWORD, ARGON2, BEARER_TOKEN, JWT, EMAIL];

/** Every sentinel, as free text: the shape an interpolated message takes. */
const SENTINEL_TEXT = `login for ${EMAIL} with hash ${ARGON2}, header Bearer ${BEARER_TOKEN}, jwt ${JWT}`;

function deepSubtree(): Record<string, unknown> {
  let node: Record<string, unknown> = {
    password: PASSWORD,
    hash: ARGON2,
    note: SENTINEL_TEXT,
  };
  for (let i = 0; i < 12; i++) node = { level: i, child: node };
  return node;
}

/** Emit the same line set through `log`, covering every carrier. */
function emitEverywhere(log: ReturnType<typeof createLogger>): void {
  // 1. In the message string itself.
  log.error(`Request failed: ${SENTINEL_TEXT}`, {
    route: '/trpc/auth.login',
    userId: 'user-control-1',
    statusCode: 500,
  });
  // 2. In a first-argument object.
  log.error({ email: EMAIL, password: PASSWORD, detail: SENTINEL_TEXT, route: '/trpc/auth.login' });
  // 3. In a positional Error's message (and therefore its stack).
  log.error(new Error(`driver said: ${SENTINEL_TEXT}`), { userId: 'user-control-1' });
  // 4. In an Error riding the data argument, and in a too-deep subtree.
  log.error('Nested failure', {
    err: new Error(SENTINEL_TEXT),
    context: deepSubtree(),
    userId: 'user-control-1',
  });
}

function expectRedacted(output: string): void {
  for (const sentinel of SENTINELS) {
    expect(output).not.toContain(sentinel);
  }
  // Fragments too, so a partial match cannot pass as a redaction.
  expect(output).not.toContain('sentinelBearerValue');
  expect(output).not.toContain('sentinel.person');
  expect(output).not.toContain('$argon2id$');
}

function expectControl(output: string): void {
  expect(output).toContain('"requestId":"req-control-1"');
  expect(output).toContain('/trpc/auth.login');
  expect(output).toContain('user-control-1');
  expect(output).toContain('"statusCode":500');
  expect(output).toContain('Request failed');
  expect(output).toContain('Nested failure');
  expect(output).toContain('driver said');
  expect(output).toContain('"context":"Auth"');
  expect(output).toContain('[REDACTED]');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('log redaction boundary', () => {
  it('structured stdout never emits a sentinel, and keeps ordinary context', () => {
    const lines: string[] = [];
    vi.spyOn(runtimeConsole, 'error').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });

    emitEverywhere(createLogger('Auth', { structured: true, requestId: 'req-control-1' }));

    expect(lines).toHaveLength(4);
    for (const line of lines) expect(() => JSON.parse(line) as unknown).not.toThrow();
    const output = lines.join('\n');
    expectRedacted(output);
    expectControl(output);
  });

  it('the file sink never emits a sentinel, and keeps ordinary context', () => {
    // The file transport writes the log to disk. Dev
    // console output is deliberately unredacted, so silence it here.
    vi.spyOn(runtimeConsole, 'error').mockImplementation(() => undefined);
    const written: string[] = [];

    emitEverywhere(
      createLogger('Auth', {
        requestId: 'req-control-1',
        fileTransport: (line) => written.push(line),
      }),
    );

    expect(written).toHaveLength(4);
    const output = written.join('');
    expectRedacted(output);
    // The file entry carries no requestId binding; everything else must hold.
    expect(output).toContain('/trpc/auth.login');
    expect(output).toContain('user-control-1');
    expect(output).toContain('"statusCode":500');
    expect(output).toContain('driver said');
    expect(output).toContain('"context":"Auth"');
    expect(output).toContain('[REDACTED: depth]');
  });

  it('keeps the requestId binding legible but scrubs one that arrives shaped like a secret', () => {
    const lines: string[] = [];
    vi.spyOn(runtimeConsole, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });

    createLogger('Http', { structured: true, getRequestId: () => `Bearer ${BEARER_TOKEN}` }).info(
      'handled',
    );

    expect(lines[0]).not.toContain(BEARER_TOKEN);
    expect(lines[0]).toContain('"requestId":"[REDACTED]"');
  });
});
