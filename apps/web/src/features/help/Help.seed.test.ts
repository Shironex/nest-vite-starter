import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOURS } from './Help.tours';

/**
 * The e2e seed answers every tour in the registry, and one account answers none.
 *
 * `packages/database/prisma/seed.ts` writes an answered `TourProgress` entry
 * for each id in its own `E2E_ANSWERED_TOURS` list, which is how the Playwright
 * suite stays free of a driver.js overlay landing on top of a click. The client
 * decides purely on the tour ID, so a tour added to the registry and not to
 * that list re-arms an auto-start in CI, on some unrelated screen, in some
 * unrelated spec, as a click that retries until it times out. That is a long
 * way from the edit that caused it.
 *
 * Reading the seed as text rather than importing it: the module connects to a
 * database and runs `main()` on import. The literal is what a person edits, and
 * the literal is what this reads.
 */
const SEED = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'packages',
  'database',
  'prisma',
  'seed.ts',
);

function seedList(name: string): string[] {
  const source = readFileSync(SEED, 'utf8');
  const body = new RegExp(`const ${name} = \\[(?<body>[^\\]]*)\\]`, 'u').exec(source)?.groups?.body;
  if (body === undefined) throw new Error(`${name} not found in ${SEED}`);
  return [...body.matchAll(/'(?<value>[^']+)'/gu)].map((match) => match.groups?.value ?? '');
}

describe('the e2e seed and the tour registry agree', () => {
  it('answers every registered tour', () => {
    expect([...seedList('E2E_ANSWERED_TOURS')].sort()).toEqual(TOURS.map((tour) => tour.id).sort());
  });

  it('holds one fixture account back so an auto-start is still proved', () => {
    // Without this the seed could answer everything for everybody, the suite
    // would be green, and a tour that stopped starting would be nobody's
    // failing test. e2e/help-tour.spec.ts signs in as this account.
    const source = readFileSync(SEED, 'utf8');

    expect(source).toContain("const E2E_TOUR_FIXTURE_EMAIL = 'e2e-tour@example.com'");
    expect(source).toContain('E2E_TOUR_FIXTURE_EMAIL,');
  });
});
