import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { validationSchema } from './configuration.config';

/**
 * Keeps `.env.example` and the api's env schema in step: every key the schema
 * declares is documented, and every documented key is either read by the api or
 * listed below with the process that reads it. A new env var that skips the
 * example file (or a stale one left behind after a removal) fails here.
 */
const ENV_EXAMPLE = join(__dirname, '..', '..', '..', '..', '.env.example');

/** Keys in `.env.example` that another process reads, not the api's ConfigModule. */
const READ_ELSEWHERE: Readonly<Record<string, string>> = {
  POSTGRES_USER: 'docker compose (postgres service)',
  POSTGRES_PASSWORD: 'docker compose (postgres service)',
  POSTGRES_DB: 'docker compose (postgres service)',
  REDIS_PASSWORD: 'docker compose (redis service)',
  SEED_DEV_ALLOW_REMOTE: 'packages/database dev seed',
  SEED_DEV_CONFIRM_DATABASE: 'packages/database dev seed',
  VITE_API_PROXY_TARGET: 'apps/web vite.config.ts',
  VITE_SENTRY_DSN: 'apps/web build',
  VITE_TURNSTILE_SITE_KEY: 'apps/web build',
};

/** Active (`KEY=`) and commented-out (`# KEY=`) assignments; prose lines are skipped. */
function exampleKeys(): Set<string> {
  const keys = new Set<string>();
  for (const line of readFileSync(ENV_EXAMPLE, 'utf8').split(/\r?\n/u)) {
    const match = /^#?\s*([A-Z][A-Z0-9_]*)=/u.exec(line);
    if (match?.[1]) keys.add(match[1]);
  }
  return keys;
}

function schemaKeys(): string[] {
  const description = validationSchema.describe() as { keys?: Record<string, unknown> };
  return Object.keys(description.keys ?? {});
}

describe('.env.example matches the env schema', () => {
  const documented = exampleKeys();
  const declared = schemaKeys();

  it('reads a non-trivial set of keys from both sides', () => {
    expect(documented.size).toBeGreaterThan(10);
    expect(declared.length).toBeGreaterThan(10);
  });

  it('documents every key the schema declares', () => {
    const missing = declared.filter((key) => !documented.has(key));
    expect(missing).toEqual([]);
  });

  it('declares or explains every key the example documents', () => {
    const known = new Set([...declared, ...Object.keys(READ_ELSEWHERE)]);
    const unexplained = [...documented].filter((key) => !known.has(key));
    expect(unexplained).toEqual([]);
  });

  it('keeps no stale READ_ELSEWHERE entry', () => {
    const stale = Object.keys(READ_ELSEWHERE).filter(
      (key) => !documented.has(key) || declared.includes(key),
    );
    expect(stale).toEqual([]);
  });
});
