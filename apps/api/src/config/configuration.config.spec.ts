import { validationSchema } from './configuration.config';

/**
 * The Joi schema is the boot-time gate, so its non-trivial rules are asserted
 * here rather than discovered on a deploy. Only the keys this suite names are exercised;
 * `allowUnknown` mirrors what ConfigModule passes at runtime, and the other
 * required keys come from test/setup-env.ts via process.env.
 */
const validate = (overrides: Record<string, string>) =>
  validationSchema.validate(
    { ...process.env, ...overrides },
    { allowUnknown: true, abortEarly: false },
  );

describe('configuration validation schema', () => {
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
});
