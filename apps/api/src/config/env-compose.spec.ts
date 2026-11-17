import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ENV_KEYS } from './env';

/**
 * Keeps docker-compose.prod.yml, `.env.prod.example` and the api's env schema in
 * step: every value the compose file interpolates is documented in the example,
 * and every key the example or the compose file hands to the api exists in the
 * schema, so a renamed or removed key cannot leave the self-host stack passing a
 * variable the api ignores.
 */
const ROOT = join(__dirname, '..', '..', '..', '..');
const COMPOSE = readFileSync(join(ROOT, 'docker-compose.prod.yml'), 'utf8');
const EXAMPLE = readFileSync(join(ROOT, '.env.prod.example'), 'utf8');

/** Keys in `.env.prod.example` that only compose (or the web container) reads. */
const COMPOSE_ONLY = new Set([
  'WEB_PORT',
  'API_PORT',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
  'REDIS_PASSWORD',
  'TURNSTILE_SITE_KEY',
  'API_SENTRY_DSN',
  'WEB_SENTRY_DSN',
  'WEB_API_URL',
  'API_IMAGE',
  'WEB_IMAGE',
]);

/** Keys set on a service that are not the api's env schema (compose or web runtime config). */
const NOT_API_SCHEMA = new Set([
  'RUN_MIGRATIONS',
  'API_URL',
  'API_UPSTREAM',
  'TURNSTILE_SITE_KEY',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
  'REDIS_PASSWORD',
]);

/** Active and commented-out assignments in the example. */
function exampleKeys(): string[] {
  const keys: string[] = [];
  for (const line of EXAMPLE.split(/\r?\n/u)) {
    const match = /^#?\s*([A-Z][A-Z0-9_]*)=/u.exec(line);
    if (match?.[1]) keys.push(match[1]);
  }
  return keys;
}

describe('docker-compose.prod.yml and .env.prod.example', () => {
  const documented = new Set(exampleKeys());

  it('documents every ${VAR} the compose file interpolates', () => {
    const used = new Set(
      [...COMPOSE.matchAll(/\$\{([A-Z][A-Z0-9_]*)[:?-]/gu)].map((match) => match[1] as string),
    );
    expect([...used].filter((key) => !documented.has(key))).toEqual([]);
  });

  it('lists each key once', () => {
    const all = exampleKeys();
    expect(all.filter((key, index) => all.indexOf(key) !== index)).toEqual([]);
  });

  it('only lists keys the api schema knows or compose itself reads', () => {
    const unknown = [...documented].filter(
      (key) => !ENV_KEYS.includes(key) && !COMPOSE_ONLY.has(key),
    );
    expect(unknown).toEqual([]);
  });

  it('hands the api only keys its schema declares', () => {
    const setKeys = [...COMPOSE.matchAll(/^ {6}([A-Z][A-Z0-9_]*):/gmu)].map(
      (match) => match[1] as string,
    );
    const unknown = setKeys.filter((key) => !ENV_KEYS.includes(key) && !NOT_API_SCHEMA.has(key));
    expect(unknown).toEqual([]);
  });
});
