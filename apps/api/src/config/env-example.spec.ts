import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ENV_KEYS } from './env';

/**
 * Keeps `.env.example` and the api's env schema (env.ts) in step: the example
 * lists exactly the schema's keys, plus the few keys another process reads,
 * each named below with its reader. A new key that skips the example file, a
 * stale one left behind after a removal, or a duplicate fails here.
 */
const ENV_EXAMPLE = join(__dirname, '..', '..', '..', '..', '.env.example');

/** Keys in `.env.example` that another process reads, not the api. */
const READ_ELSEWHERE: Readonly<Record<string, string>> = {
  ADMIN_EMAIL: 'packages/database seed and the web e2e specs',
  ADMIN_PASSWORD: 'packages/database seed and the web e2e specs',
  SEED_DEV_ALLOW_REMOTE: 'packages/database dev seed',
  SEED_DEV_CONFIRM_DATABASE: 'packages/database dev seed',
  VITE_API_PROXY_TARGET: 'apps/web vite.config.ts',
};

/** Active (`KEY=`) and commented-out (`# KEY=`) assignments, in file order. */
function exampleKeys(): string[] {
  const keys: string[] = [];
  for (const line of readFileSync(ENV_EXAMPLE, 'utf8').split(/\r?\n/u)) {
    const match = /^#?\s*([A-Z][A-Z0-9_]*)=/u.exec(line);
    if (match?.[1]) keys.push(match[1]);
  }
  return keys;
}

describe('.env.example matches the env schema', () => {
  const documented = exampleKeys();

  it('lists each key once', () => {
    const duplicates = documented.filter((key, index) => documented.indexOf(key) !== index);
    expect(duplicates).toEqual([]);
  });

  it('lists exactly the schema keys plus the keys other processes read', () => {
    const expected = [...ENV_KEYS, ...Object.keys(READ_ELSEWHERE)].sort();
    expect([...new Set(documented)].sort()).toEqual(expected);
  });

  it('never claims a schema key is read elsewhere', () => {
    expect(Object.keys(READ_ELSEWHERE).filter((key) => ENV_KEYS.includes(key))).toEqual([]);
  });
});
