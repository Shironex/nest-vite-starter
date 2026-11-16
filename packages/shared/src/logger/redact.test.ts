import { describe, expect, it } from 'vitest';
import {
  createCredentialSegmentRedactor,
  CREDENTIAL_PATH_PREFIXES,
  isSensitiveKey,
  redactCredentialPath,
  redactCredentialSegments,
  redactSensitive,
  SAFE_KEY_ALLOWLIST,
  scrubText,
  SENSITIVE_KEY_PATTERNS,
} from './index';

describe('SENSITIVE_KEY_PATTERNS / isSensitiveKey', () => {
  it('matches compound keys by case-insensitive substring', () => {
    expect(isSensitiveKey('accessToken')).toBe(true);
    expect(isSensitiveKey('userEmail')).toBe(true);
    expect(isSensitiveKey('sessionId')).toBe(true);
    expect(isSensitiveKey('x-csrf-token')).toBe(true);
    expect(isSensitiveKey('set-cookie')).toBe(true);
    expect(isSensitiveKey('Authorization')).toBe(true);
    expect(isSensitiveKey('api-key')).toBe(true);
    expect(isSensitiveKey('encryption_key')).toBe(true);
  });

  it('does not match plainly harmless keys', () => {
    expect(isSensitiveKey('requestDurationMs')).toBe(false);
    expect(isSensitiveKey('statusCode')).toBe(false);
    expect(isSensitiveKey('displayName')).toBe(false);
  });

  it('exposes a non-empty readonly pattern list', () => {
    expect(SENSITIVE_KEY_PATTERNS.length).toBeGreaterThan(0);
  });

  describe('userId is an identifier, not a secret', () => {
    // Decision: the audit trail already stores userId raw in a queryable
    // column, so denying it in logs defends nothing and costs every 500 its
    // "which account hit this" answer.
    it.each(['userId', 'user_id', 'userIds', 'actorUserId', 'signerUserId', 'targetUserId'])(
      'does not redact %s',
      (key) => {
        expect(isSensitiveKey(key)).toBe(false);
      },
    );

    it('still redacts the session identifier family', () => {
      expect(isSensitiveKey('sessionId')).toBe(true);
      expect(isSensitiveKey('session_id')).toBe(true);
      expect(isSensitiveKey('currentSessionId')).toBe(true);
      expect(isSensitiveKey('sid')).toBe(true);
      expect(isSensitiveKey('sidCookieName')).toBe(true);
    });
  });

  describe('SAFE_KEY_ALLOWLIST (exact match, checked first)', () => {
    it.each([
      ['contentType', 'content'],
      ['ContentLength', 'content'],
      ['className', 'ssn'],
      ['sidebarCollapsed', 'sid'],
      ['daysId', 'sid'],
      ['emailSent', 'email'],
      ['releaseNotes', 'notes'],
    ])('exempts %s despite the %s substring', (key) => {
      expect(isSensitiveKey(key)).toBe(false);
    });

    it('exempts whole keys only, never a key that merely contains one', () => {
      expect(isSensitiveKey('noteContent')).toBe(true);
      expect(isSensitiveKey('contentTypeToken')).toBe(true);
    });

    it('never exempts a genuine secret or PII key', () => {
      for (const safe of SAFE_KEY_ALLOWLIST) {
        expect(['password', 'secret', 'token', 'iban']).not.toContain(safe);
      }
      // residenceDocEnc looks like `sid` collateral but is deliberately denied:
      // the `residencedoc` personal-data pattern owns it.
      expect(isSensitiveKey('residenceDocEnc')).toBe(true);
      expect(isSensitiveKey('residenceDocMasked')).toBe(true);
    });
  });
});

describe('redactSensitive', () => {
  it('redacts compound keys like accessToken and userEmail', () => {
    const input = {
      accessToken: 'sk_live_abc',
      userEmail: 'someone@example.com',
      nested: { sessionId: 'deadbeef', requestId: 'req-1' },
    };

    const out = redactSensitive(input) as Record<string, unknown>;

    expect(out.accessToken).toBe('[REDACTED]');
    expect(out.userEmail).toBe('[REDACTED]');
    expect((out.nested as Record<string, unknown>).sessionId).toBe('[REDACTED]');
    expect((out.nested as Record<string, unknown>).requestId).toBe('req-1');
  });

  it('redacts exact keys covered by the original anchored list', () => {
    const input = { password: 'hunter2', email: 'a@b.c', phone: '123', ssn: '000' };
    const out = redactSensitive(input) as Record<string, unknown>;
    expect(out).toEqual({
      password: '[REDACTED]',
      email: '[REDACTED]',
      phone: '[REDACTED]',
      ssn: '[REDACTED]',
    });
  });

  it('walks arrays and does not mutate the input', () => {
    const input = { list: [{ csrfToken: 'x' }, { ok: 1 }] };
    const out = redactSensitive(input) as { list: Record<string, unknown>[] };
    expect(out.list[0]?.csrfToken).toBe('[REDACTED]');
    expect(out.list[1]?.ok).toBe(1);
    expect(input.list[0]?.csrfToken).toBe('x');
  });

  it('keeps userId legible so a 500 can be traced to an account', () => {
    const input = { userId: 'u-1', userEmail: 'a@b.c', statusCode: 500 };
    const out = redactSensitive(input) as Record<string, unknown>;
    expect(out.userId).toBe('u-1');
    expect(out.userEmail).toBe('[REDACTED]');
    expect(out.statusCode).toBe(500);
  });

  it('flattens an Error instead of walking it into an empty object', () => {
    const out = redactSensitive({ err: new Error('boom') }) as {
      err: Record<string, unknown>;
    };
    expect(out.err.message).toBe('boom');
    expect(String(out.err.stack)).toContain('boom');
  });

  it('passes primitives and null/undefined through', () => {
    expect(redactSensitive('plain')).toBe('plain');
    expect(redactSensitive(42)).toBe(42);
    expect(redactSensitive(null)).toBeNull();
    expect(redactSensitive(undefined)).toBeUndefined();
  });

  it('redacts a sensitive key nested eight levels deep', () => {
    const input = { a: { b: { c: { d: { e: { f: { g: { password: 'hunter2', ok: 1 } } } } } } } };

    const out = JSON.stringify(redactSensitive(input));

    expect(out).not.toContain('hunter2');
    expect(out).toContain('"password":"[REDACTED]"');
    expect(out).toContain('"ok":1');
  });

  it('replaces a subtree past the depth cap with a marker instead of returning it', () => {
    // The bug: past the cap the walker used to hand the subtree back as is,
    // so "too deep to inspect" meant "publish it".
    let deep: Record<string, unknown> = { password: 'hunter2', token: 'sk_live_abc' };
    for (let i = 0; i < 12; i++) deep = { level: i, next: deep };

    const out = JSON.stringify(redactSensitive(deep));

    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('sk_live_abc');
    expect(out).toContain('[REDACTED: depth]');
    // The levels above the cap are still legible.
    expect(out).toContain('"level":11');
  });

  it('terminates on a self-referential object', () => {
    const cyclic: Record<string, unknown> = { name: 'req' };
    cyclic.self = cyclic;
    expect(JSON.stringify(redactSensitive(cyclic))).toContain('[REDACTED: depth]');
  });

  it('scrubs secret shapes out of string leaves under innocuous keys', () => {
    const out = redactSensitive({
      detail: 'header was Bearer abc.def-ghi for a@example.com',
      requestId: 'req-1',
    }) as Record<string, unknown>;
    expect(out.detail).toBe('header was [REDACTED] for [REDACTED]');
    expect(out.requestId).toBe('req-1');
  });
});

describe('scrubText', () => {
  const ARGON2 =
    '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$RdescudvJCsgt3ub+b+dWRWJTmaaJObG';
  const BCRYPT = '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';
  const JWT =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  const SESSION_TOKEN = 'a'.repeat(32) + '0123456789abcdef'.repeat(2);

  it.each([
    ['an argon2id PHC hash', `stored ${ARGON2} for the account`],
    ['a bcrypt hash', `legacy hash ${BCRYPT}`],
    ['a Bearer token', 'Authorization: Bearer sk_live_abc123.def'],
    ['a lower-case bearer token', 'authorization: bearer sk_live_abc123.def'],
    ['a JWT', `id_token=${JWT}`],
    ['a 64-hex session token', `session ${SESSION_TOKEN} expired`],
    ['a 64-hex token inside a credential path', `/api/feed/${SESSION_TOKEN}.ics`],
    ['an email address', 'invite sent to john.johnson+team@example.com'],
  ])('removes %s', (_label, text) => {
    const out = scrubText(text);
    expect(out).toContain('[REDACTED]');
    for (const secret of [ARGON2, BCRYPT, JWT, SESSION_TOKEN, 'sk_live_abc123', 'johnson']) {
      expect(out).not.toContain(secret);
    }
  });

  it.each([
    ['a uuid request id', 'req 3f2b8c1e-9d4a-4f6b-8e2a-1c3d5e7f9a0b'],
    ['a W3C trace id and span id', 'trace 4bf92f3577b34da6a3ce929d0e0e4736 span 00f067aa0ba902b7'],
    ['a cuid', 'user cm1x2y3z4000008l0a1b2c3d4'],
    ['an ISO timestamp and epoch millis', '2026-09-19T10:00:00.000Z 1789992000000'],
    ['a procedure path and app code', 'tRPC error [mutation] auth.login (VALIDATION_ERROR)'],
    [
      'a scoped package path in a stack frame',
      'at /app/node_modules/.pnpm/@sentry+node@10.67.0/x.js',
    ],
    ['a sha512 hex digest (not the token shape)', 'f'.repeat(128)],
  ])('leaves %s alone', (_label, text) => {
    expect(scrubText(text)).toBe(text);
  });
});

describe('redactCredentialPath', () => {
  it('leaves ordinary paths untouched so access logs stay useful', () => {
    expect(redactCredentialPath('/api/csrf-token')).toBe('/api/csrf-token');
    expect(redactCredentialPath('/health')).toBe('/health');
    expect(redactCredentialPath('/trpc/user.me')).toBe('/trpc/user.me');
  });

  it('covers every declared credential prefix', () => {
    for (const prefix of CREDENTIAL_PATH_PREFIXES) {
      expect(redactCredentialPath(`${prefix}secret-value`)).toBe(`${prefix}[REDACTED]`);
    }
  });
});

describe('redactCredentialSegments', () => {
  it('leaves text without a credential prefix untouched', () => {
    expect(redactCredentialSegments('GET /trpc/user.me?batch=1')).toBe('GET /trpc/user.me?batch=1');
  });
});

describe('createCredentialSegmentRedactor', () => {
  it('redacts only the prefixes it was built with, escaping regex metacharacters', () => {
    const redact = createCredentialSegmentRedactor(['/auth/invite/', '/a.b/']);
    expect(redact('https://app.example/auth/invite/tok123')).toBe(
      'https://app.example/auth/invite/[REDACTED]',
    );
    expect(redact('/a.b/secret')).toBe('/a.b/[REDACTED]');
    // `.` is literal, so `/axb/` is not a match.
    expect(redact('/axb/secret')).toBe('/axb/secret');
    expect(redact('/api/feed/a.ics')).toBe('/api/feed/a.ics');
  });

  it('redacts nothing when built with no prefixes', () => {
    expect(createCredentialSegmentRedactor([])('/api/feed/a.ics')).toBe('/api/feed/a.ics');
  });
});
