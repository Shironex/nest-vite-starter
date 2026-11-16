import { validationSchema } from './configuration.config';

/**
 * The Joi schema is the boot-time gate, so the OAuth keys' both-or-neither rule
 * and the production requirement on API_PUBLIC_URL are asserted here rather
 * than discovered on a deploy. Only the keys this suite names are exercised;
 * `allowUnknown` mirrors what ConfigModule passes at runtime, and the other
 * required keys come from test/setup-env.ts via process.env.
 */
const validate = (overrides: Record<string, string>) =>
  validationSchema.validate(
    { ...process.env, ...overrides },
    { allowUnknown: true, abortEarly: false },
  );

describe('configuration validation schema', () => {
  describe('API_PUBLIC_URL', () => {
    it('defaults to the local api origin outside production', () => {
      const { error, value } = validate({ NODE_ENV: 'development', API_PUBLIC_URL: '' });
      expect(error).toBeUndefined();
      expect((value as Record<string, unknown>).API_PUBLIC_URL).toBe('http://localhost:3000');
    });

    it('is required in production so redirect_uri cannot silently fall back to localhost', () => {
      const { error } = validate({ NODE_ENV: 'production', API_PUBLIC_URL: '' });
      expect(error?.message).toMatch(/API_PUBLIC_URL/);
    });
  });

  describe('APP_TIME_ZONE', () => {
    it('defaults to UTC when unset', () => {
      const { error, value } = validate({ APP_TIME_ZONE: '' });
      expect(error).toBeUndefined();
      expect((value as Record<string, unknown>).APP_TIME_ZONE).toBe('UTC');
    });

    it('accepts an IANA zone', () => {
      const { error } = validate({ APP_TIME_ZONE: 'America/New_York' });
      expect(error).toBeUndefined();
    });

    it('rejects a zone Intl does not know', () => {
      const { error } = validate({ APP_TIME_ZONE: 'Mars/Olympus_Mons' });
      expect(error?.message).toMatch(/APP_TIME_ZONE/);
    });
  });

  describe('Google OAuth credential pair', () => {
    it('accepts both keys absent, which disables the provider rather than failing boot', () => {
      const { error } = validate({ OAUTH_GOOGLE_CLIENT_ID: '', OAUTH_GOOGLE_CLIENT_SECRET: '' });
      expect(error).toBeUndefined();
    });

    it('accepts a complete pair', () => {
      const { error } = validate({
        OAUTH_GOOGLE_CLIENT_ID: 'an-id',
        OAUTH_GOOGLE_CLIENT_SECRET: 'a-secret',
      });
      expect(error).toBeUndefined();
    });

    it('rejects a client id with no secret', () => {
      const { error } = validate({
        OAUTH_GOOGLE_CLIENT_ID: 'an-id',
        OAUTH_GOOGLE_CLIENT_SECRET: '',
      });
      expect(error?.message).toMatch(/OAUTH_GOOGLE_CLIENT_SECRET/);
    });

    it('rejects a secret with no client id', () => {
      const { error } = validate({
        OAUTH_GOOGLE_CLIENT_ID: '',
        OAUTH_GOOGLE_CLIENT_SECRET: 'a-secret',
      });
      expect(error?.message).toMatch(/OAUTH_GOOGLE_CLIENT_ID/);
    });
  });

  it('defaults OAUTH_ALLOW_SIGNUP open, matching password signup', () => {
    const { error, value } = validate({});
    expect(error).toBeUndefined();
    expect((value as Record<string, unknown>).OAUTH_ALLOW_SIGNUP).toBe(true);
  });
});

describe('ISOLATION_CANARY_DISABLE_MODEL', () => {
  const validate = (overrides: Record<string, string>) =>
    validationSchema.validate(
      { ...process.env, ...overrides },
      { allowUnknown: true, abortEarly: false },
    );

  it('accepts the documented blank from .env.example in any environment', () => {
    const { error } = validate({
      NODE_ENV: 'production',
      API_PUBLIC_URL: 'https://api.example.test',
      ISOLATION_CANARY_DISABLE_MODEL: '',
    });
    expect(error).toBeUndefined();
  });

  it('refuses a mutant selector in production, so the switch cannot be enabled there', () => {
    const { error } = validate({
      NODE_ENV: 'production',
      API_PUBLIC_URL: 'https://api.example.test',
      ISOLATION_CANARY_DISABLE_MODEL: 'workspace',
    });
    expect(error?.message).toMatch(/ISOLATION_CANARY_DISABLE_MODEL/);
  });

  it('refuses it in development too: only the test lane may mutate the registry', () => {
    const { error } = validate({
      NODE_ENV: 'development',
      ISOLATION_CANARY_DISABLE_MODEL: 'workspace',
    });
    expect(error?.message).toMatch(/ISOLATION_CANARY_DISABLE_MODEL/);
  });

  it('allows it under NODE_ENV=test, where the canary runner sets it', () => {
    const { error } = validate({ NODE_ENV: 'test', ISOLATION_CANARY_DISABLE_MODEL: 'workspace' });
    expect(error).toBeUndefined();
  });
});
