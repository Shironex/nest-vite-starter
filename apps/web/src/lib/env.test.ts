import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRODUCT_NAME } from '@repo/shared/constants';
import { parseAppConfig } from './env';

describe('parseAppConfig', () => {
  it('reads every key as a trimmed string', () => {
    expect(
      parseAppConfig({
        API_URL: ' https://api.example.com ',
        TURNSTILE_SITE_KEY: 'site',
        SENTRY_DSN: 'dsn',
        APP_NAME: 'Acme',
      }),
    ).toEqual({
      API_URL: 'https://api.example.com',
      TURNSTILE_SITE_KEY: 'site',
      SENTRY_DSN: 'dsn',
      APP_NAME: 'Acme',
    });
  });

  it('drops a trailing slash from API_URL so `${API_URL}/trpc` stays one slash', () => {
    expect(parseAppConfig({ API_URL: 'https://api.example.com//' }).API_URL).toBe(
      'https://api.example.com',
    );
  });

  it('reads a missing object, a wrong type and an absent key as empty', () => {
    const empty = { API_URL: '', TURNSTILE_SITE_KEY: '', SENTRY_DSN: '', APP_NAME: '' };
    expect(parseAppConfig(undefined)).toEqual(empty);
    expect(parseAppConfig(null)).toEqual(empty);
    expect(parseAppConfig('nope')).toEqual(empty);
    expect(parseAppConfig({ SENTRY_DSN: 42, APP_NAME: null })).toEqual(empty);
  });
});

describe('module values', () => {
  afterEach(() => {
    delete window.__APP_CONFIG__;
    vi.resetModules();
  });

  it('falls back to the built-in product name and same-origin api calls', async () => {
    vi.resetModules();
    const env = await import('./env');
    expect(env.APP_NAME).toBe(PRODUCT_NAME);
    expect(env.apiUrl('/trpc')).toBe('/trpc');
    expect(env.API_CREDENTIALS).toBe('same-origin');
  });

  it('prefixes api paths and sends cookies cross-origin once API_URL is set', async () => {
    vi.resetModules();
    window.__APP_CONFIG__ = { API_URL: 'https://api.example.com/', APP_NAME: 'Acme' };
    const env = await import('./env');
    expect(env.APP_NAME).toBe('Acme');
    expect(env.apiUrl('/trpc')).toBe('https://api.example.com/trpc');
    expect(env.API_CREDENTIALS).toBe('include');
  });
});
