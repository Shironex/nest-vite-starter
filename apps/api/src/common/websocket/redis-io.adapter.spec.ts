import type { ConfigService } from '@nestjs/config';

import { DESKTOP_APP_ORIGIN } from '@repo/shared/constants';
import { createHandshakeOriginGuard, resolveSocketCorsOptions } from './redis-io.adapter';

// Build a ConfigService stand-in whose get() reads from a plain key map.
const configWith = (values: Record<string, string | undefined>): ConfigService =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('resolveSocketCorsOptions', () => {
  it('uses the localhost + app origins in development', () => {
    const cors = resolveSocketCorsOptions(configWith({ NODE_ENV: 'development' }));
    expect(cors).toEqual({
      origin: ['http://localhost:5173', 'app://app'],
      credentials: true,
    });
  });

  it('splits CORS_ORIGINS (trimmed) in production', () => {
    const cors = resolveSocketCorsOptions(
      configWith({ NODE_ENV: 'production', CORS_ORIGINS: 'https://a.example, https://b.example' }),
    );
    expect(cors).toEqual({
      origin: ['https://a.example', 'https://b.example'],
      credentials: true,
    });
  });

  it('falls back to APP_URL + app origin in production when CORS_ORIGINS is unset', () => {
    const cors = resolveSocketCorsOptions(
      configWith({ NODE_ENV: 'production', APP_URL: 'https://app.example' }),
    );
    expect(cors).toEqual({
      origin: ['https://app.example', 'app://app'],
      credentials: true,
    });
  });

  it('treats an empty CORS_ORIGINS as unset and falls back (not [""])', () => {
    const cors = resolveSocketCorsOptions(
      configWith({ NODE_ENV: 'production', CORS_ORIGINS: '   ', APP_URL: 'https://app.example' }),
    );
    expect(cors.origin).toEqual(['https://app.example', 'app://app']);
    expect(cors.origin).not.toContain('');
  });

  it('credentials is always true', () => {
    expect(resolveSocketCorsOptions(configWith({ NODE_ENV: 'production' })).credentials).toBe(true);
    expect(resolveSocketCorsOptions(configWith({ NODE_ENV: 'development' })).credentials).toBe(
      true,
    );
  });
});

describe('createHandshakeOriginGuard', () => {
  const allowed = ['https://app.example', DESKTOP_APP_ORIGIN];

  /** engine.io calls `allowRequest(req, callback)`; the guard never errors. */
  const decide = (origin?: string): boolean => {
    let allow: boolean | undefined;
    createHandshakeOriginGuard(allowed)({ headers: { origin } }, (_error, result) => {
      allow = result;
    });
    return allow as boolean;
  };

  it('accepts a handshake from an allowed browser origin', () => {
    expect(decide('https://app.example')).toBe(true);
  });

  it('keeps the Electron shell working', () => {
    // The renderer sends the app:// origin, which is in the same allow list.
    expect(decide(DESKTOP_APP_ORIGIN)).toBe(true);
  });

  it('refuses a handshake from a foreign origin even with a valid session cookie', () => {
    // The cookie rides the upgrade: `cors` alone would have accepted this.
    expect(decide('https://evil.example')).toBe(false);
  });

  it('refuses a sibling host and a prefix lookalike, matching exactly', () => {
    expect(decide('https://app.example.evil.test')).toBe(false);
    expect(decide('https://other.app.example')).toBe(false);
  });

  it('refuses a handshake with no Origin header at all', () => {
    expect(decide(undefined)).toBe(false);
  });
});
