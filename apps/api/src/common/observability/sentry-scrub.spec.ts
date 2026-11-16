import { scrubEvent, scrubBreadcrumb, scrubPathString, scrubQueryParams } from './sentry-scrub';

// The scrubber reads HOME / USER at module-load time. The CI runner's real
// values are arbitrary, so we assert against whatever the process reports
// rather than hard-coding a username. We build synthetic paths from the live
// env so the strip is exercised against the actual sentinels.
const HOME = (process.env.HOME || process.env.USERPROFILE || '').trim();
const USER = (process.env.USER || process.env.LOGNAME || process.env.USERNAME || '').trim();

// A real OS username can contain regex metacharacters; the production scrubber
// escapes before building its RegExp, so assertions built from USER must too.
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('sentry-scrub (API)', () => {
  describe('scrubPathString - OS username / home dir', () => {
    it('rewrites the home directory to a sentinel', () => {
      if (!HOME) return; // env without HOME, nothing to assert
      const input = `${HOME}/app/apps/api/dist/main.js`;
      const out = scrubPathString(input);
      expect(out).not.toContain(HOME);
      expect(out).toContain('<home>');
    });

    it('rewrites a bare username occurrence', () => {
      if (!USER || USER.length < 3) return;
      const out = scrubPathString(`error thrown for ${USER} during build`);
      expect(out).not.toMatch(new RegExp(`\\b${escapeRegExp(USER)}\\b`));
      expect(out).toContain('<user>');
    });
  });

  describe('scrubEvent - OS paths in message + exception + every frame', () => {
    it('strips home/username from message, exception value, and all stack frames', () => {
      if (!HOME) return;
      const event = scrubEvent({
        message: `boom at ${HOME}/app/src/foo.ts`,
        exception: {
          values: [
            {
              value: `Cannot read file ${HOME}/secret/config`,
              stacktrace: {
                frames: [
                  {
                    filename: `${HOME}/app/apps/api/src/a.ts`,
                    abs_path: `${HOME}/app/apps/api/src/a.ts`,
                    module: `${HOME}.app.apps.api.src.a`,
                  },
                  {
                    filename: `${HOME}/app/apps/api/src/b.ts`,
                    abs_path: `${HOME}/app/apps/api/src/b.ts`,
                    module: 'b',
                  },
                ],
              },
            },
          ],
        },
      });

      expect(event).not.toBeNull();
      const serialized = JSON.stringify(event);
      expect(serialized).not.toContain(HOME);
      const frames = event!.exception!.values![0]!.stacktrace!.frames!;
      for (const frame of frames) {
        expect(frame.filename).not.toContain(HOME);
        expect(frame.abs_path).not.toContain(HOME);
        expect(frame.module).not.toContain(HOME);
      }
      expect(event!.message).not.toContain(HOME);
      expect(event!.exception!.values![0]!.value).not.toContain(HOME);
    });
  });

  describe('scrubEvent - app-level PII in nested extra / contexts / request / breadcrumbs', () => {
    it('redacts emails, free-text payloads, tokens, cookies, auth headers, userId - even when deeply nested', () => {
      const event = scrubEvent({
        extra: {
          requestBody: 'today I felt anxious about the deadline',
          noteContent: 'call the therapist',
          nested: {
            deeper: {
              email: 'jane@example.com',
              userId: 'usr_12345',
              accessToken: 'sk_live_abcdef',
            },
          },
        },
        contexts: {
          trace: { trace_id: 'abc', span_id: 'def' },
          auth: { authorization: 'Bearer sk_live_xyz', refreshToken: 'rt_999' },
        },
        request: {
          headers: {
            cookie: 'sid=deadbeef; csrf=cafe',
            authorization: 'Bearer leaked',
            'set-cookie': 'session=abc',
          },
          data: { body: 'plaintext entry', email: 'bob@x.io' },
        },
        breadcrumbs: [
          {
            category: 'http',
            message: 'POST /trpc/user.update',
            data: {
              email: 'nested@breadcrumb.com',
              token: 'secret-token',
              payload: { body: 'free text here' },
            },
          },
        ],
      });

      expect(event).not.toBeNull();
      const serialized = JSON.stringify(event);

      // PII values must be gone entirely.
      expect(serialized).not.toContain('jane@example.com');
      expect(serialized).not.toContain('bob@x.io');
      expect(serialized).not.toContain('nested@breadcrumb.com');
      expect(serialized).not.toContain('usr_12345');
      expect(serialized).not.toContain('sk_live_abcdef');
      expect(serialized).not.toContain('sk_live_xyz');
      expect(serialized).not.toContain('rt_999');
      expect(serialized).not.toContain('Bearer leaked');
      expect(serialized).not.toContain('deadbeef');
      expect(serialized).not.toContain('secret-token');
      expect(serialized).not.toContain('today I felt anxious about the deadline');
      expect(serialized).not.toContain('call the therapist');
      expect(serialized).not.toContain('plaintext entry');
      expect(serialized).not.toContain('free text here');

      // Non-sensitive correlation IDs survive (trace cross-link must work).
      expect(serialized).toContain('abc');
      expect(serialized).toContain('def');
    });

    it('drops nothing structurally - a clean event passes through', () => {
      const event = scrubEvent({
        message: 'a harmless error',
        tags: { route: 'health', statusCode: '500' },
      });
      expect(event).not.toBeNull();
      expect(event!.message).toBe('a harmless error');
      expect(event!.tags).toEqual({ route: 'health', statusCode: '500' });
    });

    it('redacts compound keys like accessToken, userEmail, and sessionId via the shared denylist', () => {
      const event = scrubEvent({
        extra: {
          accessToken: 'sk_live_compound',
          userEmail: 'compound@example.com',
          sessionId: 'sess_0123456789',
        },
      });

      expect(event).not.toBeNull();
      const serialized = JSON.stringify(event);
      expect(serialized).not.toContain('sk_live_compound');
      expect(serialized).not.toContain('compound@example.com');
      expect(serialized).not.toContain('sess_0123456789');
    });
  });

  describe('egress identifiers (parity with the web Sentry boundary)', () => {
    it('keeps the record identifiers that answer "which record is broken"', () => {
      // They name an opaque record, not a data subject, so redacting them would
      // cost the triage and protect nobody.
      const event = scrubEvent({
        extra: { documentId: 'doc-3', jobId: 'job-4' },
      });

      const serialized = JSON.stringify(event);
      expect(serialized).toContain('doc-3');
      expect(serialized).toContain('job-4');
    });
  });

  describe('cycle + depth safety', () => {
    it('does not loop on a self-referential extra tree', () => {
      const cyclic: Record<string, unknown> = { email: 'loop@x.io' };
      cyclic.self = cyclic;
      const event = scrubEvent({ extra: { cyclic } });
      expect(event).not.toBeNull();
      expect(JSON.stringify(event)).not.toContain('loop@x.io');
    });
  });

  describe('non-plain / exotic objects survive scrubbing intact', () => {
    it('preserves Date, Map, Set, RegExp, and typed arrays instead of wiping them to {}', () => {
      const when = new Date('2020-01-02T03:04:05.000Z');
      const event = scrubEvent({
        extra: {
          when,
          map: new Map([['k', 'v']]),
          set: new Set([1, 2, 3]),
          re: /abc/g,
          bytes: new Uint8Array([1, 2, 3, 4]),
        },
      });
      expect(event).not.toBeNull();
      const extra = event!.extra as Record<string, unknown>;
      expect(extra.when).toBe(when); // not collapsed to {}
      expect(extra.map).toBeInstanceOf(Map);
      expect((extra.map as Map<string, string>).get('k')).toBe('v');
      expect(extra.set).toBeInstanceOf(Set);
      expect(extra.re).toBeInstanceOf(RegExp);
      expect(extra.bytes).toBeInstanceOf(Uint8Array);
      expect((extra.bytes as Uint8Array).length).toBe(4); // not exploded into index keys
    });

    it('still redacts PII on a class instance, not only on plain objects', () => {
      class UserCtx {
        email = 'class@example.com';
        role = 'admin';
      }
      const event = scrubEvent({ extra: { user: new UserCtx() } });
      expect(event).not.toBeNull();
      const serialized = JSON.stringify(event);
      expect(serialized).not.toContain('class@example.com');
      expect(serialized).toContain('admin');
    });

    it('redacts PII INSIDE Map values, Set members, and Error props', () => {
      const err = Object.assign(new Error('boom'), { email: 'err@example.com' });
      const event = scrubEvent({
        extra: {
          m: new Map<string, unknown>([
            ['token', 'sk_live_map'],
            ['note', { email: 'map@example.com' }],
          ]),
          s: new Set([{ accessToken: 'sk_set' }]),
          err,
        },
      });
      expect(event).not.toBeNull();
      const extra = event!.extra as Record<string, unknown>;

      const m = extra.m as Map<string, unknown>;
      expect(m.get('token')).toBe('[redacted]'); // sensitive key redacted
      expect(m.get('note')).toEqual({ email: '[redacted]' }); // nested PII redacted

      const setMembers = Array.from(extra.s as Set<unknown>);
      expect(JSON.stringify(setMembers)).not.toContain('sk_set');
      expect(JSON.stringify(setMembers)).toContain('[redacted]');

      const scrubbedErr = extra.err as Record<string, unknown>;
      expect(scrubbedErr.email).toBe('[redacted]'); // enumerable own prop redacted
      expect(scrubbedErr.message).toBe('boom'); // message preserved (path-scrubbed)
      expect(scrubbedErr.name).toBe('Error');
    });
  });

  describe('scrubBreadcrumb - deep data scrub', () => {
    it('redacts sensitive keys inside breadcrumb data', () => {
      const crumb = scrubBreadcrumb({
        category: 'http',
        message: 'request',
        data: { authorization: 'Bearer abc', userId: 'usr_1', safe: 'ok' },
      });
      expect(crumb).not.toBeNull();
      const serialized = JSON.stringify(crumb);
      expect(serialized).not.toContain('Bearer abc');
      expect(serialized).not.toContain('usr_1');
      expect(serialized).toContain('ok');
    });
  });

  describe('credential query params', () => {
    it('scrubQueryParams blanks token values inside URL-ish strings', () => {
      const token = 'a1'.repeat(8);
      expect(scrubQueryParams(`/auth/reset-password?token=${token}&lang=en`)).toBe(
        '/auth/reset-password?token=[redacted]&lang=en',
      );
      // A bare query_string (no leading ?) is scrubbed from the string start too.
      expect(scrubQueryParams(`token=${token}&page=2`)).toBe('token=[redacted]&page=2');
    });

    it('leaves other params and non-boundary occurrences alone', () => {
      expect(scrubQueryParams('/invoices?statusCode=200&page=2')).toBe(
        '/invoices?statusCode=200&page=2',
      );
      // `subtoken=` must not be shredded by the `token=` rule (boundary match).
      expect(scrubQueryParams('/scan?subtoken=123')).toBe('/scan?subtoken=123');
    });

    it('blanks the batched tRPC input= and identifier query values, keeping the procedure path', () => {
      const input = encodeURIComponent('{"0":{"search":"Johnson","userId":"usr_9"}}');
      const event = scrubEvent({
        request: {
          url: `https://api.example/api/trpc/user.list,user.get?batch=1&input=${input}`,
          query_string: `batch=1&input=${input}`,
        },
        message: 'GET /api/users?user_id=usr_9&userId=usr_1&page=2 failed',
      });
      const serialized = JSON.stringify(event);
      expect(serialized).not.toContain('Johnson');
      expect(serialized).not.toContain('usr_9');
      expect(serialized).not.toContain('usr_1');
      expect(event?.request).toEqual({
        url: 'https://api.example/api/trpc/user.list,user.get?batch=1&input=[redacted]',
        query_string: 'batch=1&input=[redacted]',
      });
      expect(event?.message).toBe(
        'GET /api/users?user_id=[redacted]&userId=[redacted]&page=2 failed',
      );
    });

    it('redacts token keys in request/extra objects, but not statusCode/appCode', () => {
      const event = scrubEvent({
        request: {
          url: 'https://app.example/auth/verify-email?token=SECRETLINK',
          query_string: 'token=SECRETLINK',
          data: { token: 'SECRETLINK' },
        },
        extra: {
          session: { accessToken: 'SECRETAT', refresh_token: 'SECRETRT' },
          statusCode: 429,
          appCode: 'RATE_LIMITED',
        },
      });
      const serialized = JSON.stringify(event);
      expect(serialized).not.toContain('SECRETLINK');
      expect(serialized).not.toContain('SECRETAT');
      expect(serialized).not.toContain('SECRETRT');
      expect(serialized).toContain('429');
      expect(serialized).toContain('RATE_LIMITED');
    });

    it('scrubs a mailed link inside message, exception text and breadcrumb messages', () => {
      const event = scrubEvent({
        message: 'GET /auth/confirm-email-change?token=SECRETLINK failed',
        exception: {
          values: [{ value: 'redirect to /cb?token=SECRETLINK ended', stacktrace: { frames: [] } }],
        },
      });
      expect(JSON.stringify(event)).not.toContain('SECRETLINK');

      const crumb = scrubBreadcrumb({
        category: 'navigation',
        message: 'to /auth/reset-password?token=SECRETLINK',
      });
      expect(JSON.stringify(crumb)).not.toContain('SECRETLINK');
    });
  });

  describe('path-segment credentials', () => {
    it('leaves a route that only shares a prefix legible', () => {
      const event = scrubEvent({ request: { url: 'https://api.example.test/api/feedx/abc' } });
      expect(event?.request).toEqual({ url: 'https://api.example.test/api/feedx/abc' });
    });
  });
});
