import { COMMITTED_TEST_SECRETS } from './committed-test-secrets';
import { collectEnvIssues, parseEnv, validateEnv } from './env';

/**
 * The env schema is the boot gate, so every refusal is pinned here rather than
 * discovered on a deploy. Secret-shaped values are built at runtime so no
 * fixture looks like a real credential.
 */

const secret32 = (): string => ['test', 'csrf', 'x'.repeat(32)].join('-');
const encryptionKey = (): string => 'ab'.repeat(32);
const turnstileSecret = (): string => ['0x4', 'A'.repeat(30)].join('');

/** A minimal valid development environment. */
const devEnv = (): Record<string, string> => ({
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://app:app@localhost:5432/app',
  REDIS_URL: 'redis://localhost:6379',
  APP_URL: 'http://localhost:5173',
  ENCRYPTION_KEY: encryptionKey(),
});

/** A complete, valid production environment. */
const prodEnv = (): Record<string, string> => ({
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://app:app@postgres:5432/app',
  REDIS_URL: 'redis://redis:6379',
  APP_URL: 'https://app.example.com',
  TRUST_PROXY: '1',
  CSRF_SECRET: secret32(),
  ENCRYPTION_KEY: encryptionKey(),
  TURNSTILE_SECRET_KEY: turnstileSecret(),
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_USER: 'mailer',
  SMTP_PASS: ['pass', 'x'.repeat(12)].join('-'),
  MAIL_FROM: 'App <noreply@example.com>',
  SMTP_REQUIRE_TLS: 'true',
});

const quiet = { warn: () => undefined };

/** The keys `parseEnv` refuses, or [] when it accepts the input. */
function refusedKeys(raw: Record<string, string | undefined>): string[] {
  return collectEnvIssues(raw).map((issue) => issue.key);
}

describe('parseEnv', () => {
  describe('accepts a correct configuration', () => {
    it('in development, filling the dev defaults', () => {
      const env = parseEnv(devEnv(), quiet);
      expect(env).toMatchObject({
        PORT: 3000,
        TRUST_PROXY: 0,
        QUEUE_WORKER: 'inline',
        LOG_LEVEL: 'info',
        APP_TIME_ZONE: 'UTC',
        SMTP_HOST: 'localhost',
        SMTP_PORT: 1025,
        MAIL_FROM: 'noreply@localhost',
        SMTP_REQUIRE_TLS: false,
        CAPTCHA_DISABLED: true,
        CORS_ORIGINS: ['http://localhost:5173'],
      });
      expect(env.SENTRY_DSN).toBeUndefined();
    });

    it('in production', () => {
      const env = parseEnv(prodEnv(), quiet);
      expect(env).toMatchObject({
        NODE_ENV: 'production',
        TRUST_PROXY: 1,
        SMTP_PORT: 587,
        SMTP_REQUIRE_TLS: true,
        CAPTCHA_DISABLED: false,
        CORS_ORIGINS: ['https://app.example.com'],
      });
    });

    it('in production with the captcha explicitly disabled', () => {
      expect(
        refusedKeys({ ...prodEnv(), TURNSTILE_SECRET_KEY: '', CAPTCHA_DISABLED: 'true' }),
      ).toEqual([]);
    });

    it('through the ConfigModule adapter, ignoring keys it does not declare', () => {
      const env = validateEnv({ ...prodEnv(), HOME: '/home/app', UNRELATED: 'x' });
      expect(env).not.toHaveProperty('UNRELATED');
    });
  });

  it('throws on a bad key at boot', () => {
    expect(() => parseEnv({ ...devEnv(), PORT: 'abc' }, quiet)).toThrow(/PORT/);
  });

  it('lists every bad key at once and never echoes a value', () => {
    const leaked = ['leak', 'x'.repeat(8)].join('-');
    let message = '';
    try {
      parseEnv({ ...devEnv(), PORT: leaked, DATABASE_URL: leaked, REDIS_URL: '' }, quiet);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/PORT/);
    expect(message).toMatch(/DATABASE_URL/);
    expect(message).toMatch(/REDIS_URL/);
    expect(message).not.toContain(leaked);
  });

  it('requires NODE_ENV, so a deploy that forgets it never boots in dev mode', () => {
    const { NODE_ENV: _omit, ...rest } = devEnv();
    expect(refusedKeys(rest)).toContain('NODE_ENV');
  });

  describe('CORS and APP_URL in production', () => {
    it('refuses a localhost entry in CORS_ORIGINS', () => {
      expect(
        refusedKeys({
          ...prodEnv(),
          CORS_ORIGINS: 'https://app.example.com,http://localhost:5173',
        }),
      ).toEqual(['CORS_ORIGINS']);
    });

    it('refuses a 127.0.0.1 entry in CORS_ORIGINS', () => {
      expect(refusedKeys({ ...prodEnv(), CORS_ORIGINS: 'http://127.0.0.1:8080' })).toEqual([
        'CORS_ORIGINS',
      ]);
    });

    it('refuses a localhost APP_URL, which is also the CORS default', () => {
      expect(refusedKeys({ ...prodEnv(), APP_URL: 'http://localhost:5173' })).toEqual(['APP_URL']);
    });

    // Spellings of loopback that once slipped past the check. CORS_ORIGINS gets
    // the bare form the URL parser produces (anything else already fails the
    // bare-origin rule); APP_URL gets the form a person would type.
    it.each([
      ['a trailing-dot localhost', 'http://localhost.:5173', 'http://localhost.:5173'],
      ['the IPv6 unspecified address', 'http://[::]:5173', 'http://[::]:5173'],
      ['an IPv4-mapped loopback address', 'http://[::ffff:7f00:1]', 'http://[::ffff:127.0.0.1]'],
    ])('refuses %s in CORS_ORIGINS and APP_URL', (_label, origin, appUrl) => {
      expect(refusedKeys({ ...prodEnv(), CORS_ORIGINS: origin })).toEqual(['CORS_ORIGINS']);
      expect(refusedKeys({ ...prodEnv(), APP_URL: appUrl })).toEqual(['APP_URL']);
    });

    it('still accepts a public host that merely starts with 127 or ends in a dot', () => {
      expect(
        refusedKeys({
          ...prodEnv(),
          APP_URL: 'https://app.example.com.',
          CORS_ORIGINS: 'https://127.example.com',
        }),
      ).toEqual([]);
    });

    it('allows localhost outside production', () => {
      expect(refusedKeys({ ...devEnv(), CORS_ORIGINS: 'http://localhost:5173' })).toEqual([]);
    });

    it('refuses an origin with a path in any environment', () => {
      expect(refusedKeys({ ...devEnv(), CORS_ORIGINS: 'http://localhost:5173/app' })).toEqual([
        'CORS_ORIGINS',
      ]);
    });

    it('defaults CORS to the origin of APP_URL', () => {
      const env = parseEnv({ ...prodEnv(), APP_URL: 'https://app.example.com/' }, quiet);
      expect(env.CORS_ORIGINS).toEqual(['https://app.example.com']);
    });
  });

  describe('captcha in production', () => {
    it('refuses an empty TURNSTILE_SECRET_KEY without CAPTCHA_DISABLED=true', () => {
      expect(refusedKeys({ ...prodEnv(), TURNSTILE_SECRET_KEY: '' })).toEqual([
        'TURNSTILE_SECRET_KEY',
      ]);
    });

    it('refuses the Cloudflare always-pass test secret', () => {
      const testSecret = ['1x', '0'.repeat(33), 'AA'].join('');
      expect(refusedKeys({ ...prodEnv(), TURNSTILE_SECRET_KEY: testSecret })).toEqual([
        'TURNSTILE_SECRET_KEY',
      ]);
    });

    it('refuses CAPTCHA_DISABLED=true next to a configured secret', () => {
      expect(refusedKeys({ ...prodEnv(), CAPTCHA_DISABLED: 'true' })).toEqual(['CAPTCHA_DISABLED']);
    });

    it('turns the captcha off in development when the secret is empty', () => {
      expect(parseEnv({ ...devEnv(), TURNSTILE_SECRET_KEY: '' }, quiet).CAPTCHA_DISABLED).toBe(
        true,
      );
    });
  });

  describe('TRUST_PROXY', () => {
    it.each(['true', 'false', '1.5', '-1', 'loopback', '0x1', '1e1'])('refuses %p', (value) => {
      expect(refusedKeys({ ...devEnv(), TRUST_PROXY: value })).toEqual(['TRUST_PROXY']);
    });

    it('defaults to 0 hops', () => {
      expect(parseEnv(devEnv(), quiet).TRUST_PROXY).toBe(0);
    });

    it('accepts an integer hop count', () => {
      expect(parseEnv({ ...devEnv(), TRUST_PROXY: '2' }, quiet).TRUST_PROXY).toBe(2);
    });
  });

  describe('SMTP_REQUIRE_TLS', () => {
    it('refuses an empty value instead of reading it as false', () => {
      expect(refusedKeys({ ...devEnv(), SMTP_REQUIRE_TLS: '' })).toEqual(['SMTP_REQUIRE_TLS']);
    });

    it('refuses anything but true or false', () => {
      expect(refusedKeys({ ...devEnv(), SMTP_REQUIRE_TLS: 'yes' })).toEqual(['SMTP_REQUIRE_TLS']);
    });

    it('refuses false in production', () => {
      expect(refusedKeys({ ...prodEnv(), SMTP_REQUIRE_TLS: 'false' })).toEqual([
        'SMTP_REQUIRE_TLS',
      ]);
    });

    it('defaults to true in production when unset', () => {
      const { SMTP_REQUIRE_TLS: _omit, ...rest } = prodEnv();
      expect(parseEnv(rest, quiet).SMTP_REQUIRE_TLS).toBe(true);
    });
  });

  describe('CSRF_SECRET', () => {
    it('is required in production', () => {
      expect(refusedKeys({ ...prodEnv(), CSRF_SECRET: '' })).toEqual(['CSRF_SECRET']);
    });

    it('refuses fewer than 32 bytes in any environment', () => {
      expect(refusedKeys({ ...devEnv(), CSRF_SECRET: 'x'.repeat(31) })).toEqual(['CSRF_SECRET']);
      expect(refusedKeys({ ...prodEnv(), CSRF_SECRET: 'x'.repeat(31) })).toEqual(['CSRF_SECRET']);
    });

    it('generates a random secret in development and warns', () => {
      const warn = jest.fn();
      const first = parseEnv(devEnv(), { warn }).CSRF_SECRET;
      const second = parseEnv(devEnv(), { warn }).CSRF_SECRET;
      expect(Buffer.byteLength(first)).toBeGreaterThanOrEqual(32);
      expect(first).not.toEqual(second);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('CSRF_SECRET'));
    });
  });

  describe('mail in production', () => {
    it.each(['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'])(
      'requires %s',
      (key) => {
        expect(refusedKeys({ ...prodEnv(), [key]: '' })).toEqual([key]);
      },
    );
  });

  describe('SENTRY_DSN', () => {
    it('leaves Sentry off when empty', () => {
      expect(parseEnv({ ...devEnv(), SENTRY_DSN: '' }, quiet).SENTRY_DSN).toBeUndefined();
    });

    it('refuses a value that is not a URL', () => {
      expect(refusedKeys({ ...devEnv(), SENTRY_DSN: 'not a dsn' })).toEqual(['SENTRY_DSN']);
    });
  });

  describe('APP_TIME_ZONE', () => {
    it('accepts an IANA zone', () => {
      expect(
        parseEnv({ ...devEnv(), APP_TIME_ZONE: 'America/New_York' }, quiet).APP_TIME_ZONE,
      ).toBe('America/New_York');
    });

    it('rejects a zone Intl does not know', () => {
      expect(refusedKeys({ ...devEnv(), APP_TIME_ZONE: 'Mars/Olympus_Mons' })).toEqual([
        'APP_TIME_ZONE',
      ]);
    });
  });

  it('requires a well-formed ENCRYPTION_KEY', () => {
    expect(refusedKeys({ ...devEnv(), ENCRYPTION_KEY: 'too-short' })).toEqual(['ENCRYPTION_KEY']);
  });

  describe('secrets committed to the repo for tests and CI', () => {
    const cases = Object.entries(COMMITTED_TEST_SECRETS).flatMap(([key, values]) =>
      values.map((value, index) => [key, index, value] as const),
    );

    it.each(cases)('refuses %s value %i in production without echoing it', (key, _index, value) => {
      let message = '';
      try {
        parseEnv({ ...prodEnv(), [key]: value }, quiet);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(new RegExp(`${key} is a value committed to this repo`, 'u'));
      expect(message).not.toContain(value);
    });

    it('refuses the committed encryption key in upper case too', () => {
      const [key] = COMMITTED_TEST_SECRETS['ENCRYPTION_KEY'] ?? [];
      expect(refusedKeys({ ...prodEnv(), ENCRYPTION_KEY: (key ?? '').toUpperCase() })).toEqual([
        'ENCRYPTION_KEY',
      ]);
    });

    it('accepts them outside production, where the test setup uses them', () => {
      const [csrf] = COMMITTED_TEST_SECRETS['CSRF_SECRET'] ?? [];
      const [key] = COMMITTED_TEST_SECRETS['ENCRYPTION_KEY'] ?? [];
      expect(refusedKeys({ ...devEnv(), CSRF_SECRET: csrf, ENCRYPTION_KEY: key })).toEqual([]);
    });
  });
});
