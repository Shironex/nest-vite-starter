import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROLES, ALL_ROLES } from '@repo/shared/permissions';

/**
 * Every `z.enum` in packages/shared that MIRRORS a Prisma enum, against the
 * schema it mirrors.
 *
 * WHY THIS FILE EXISTS. The api's own mirrors are compile-time fenced
 * (`as const satisfies { [K in SomeEnum]: K }`), so adding a member to a
 * Prisma enum breaks the api
 * build and the developer fixes it. The shared `z.enum` copies had no such
 * fence: they stayed stale, and a stale one is not a type error anywhere. It is
 * a RUNTIME failure in production, on rows that already exist. Every router
 * `output:` schema is validated, so a row carrying the new value fails the read
 * with a 500, every input refuses it, and every web `Record<X, ...>` is
 * "exhaustive" over a list that is missing a case.
 *
 * WHY IT READS THE .prisma FILES rather than importing the generated enums.
 * `@repo/database` is ESM-only and apps/api compiles to CJS, which is why every
 * Prisma enum in this app is imported as a TYPE and never as a value; a value
 * import does not resolve under jest. Reading the schema is also the stronger
 * check: it compares against the file a developer edits, not against a
 * generated client that may not have been regenerated yet.
 *
 * WHY THE PAIRS ARE LISTED EXPLICITLY. A test that discovered pairs by naming
 * convention would pass for a new enum nobody mirrored, which is the case most
 * worth catching. Registering the pair here is the work; the assertion is free.
 */

const SCHEMA_DIR = join(__dirname, '../../../../../packages/database/prisma/schema');

/** Every `enum Name { A B }` block in the Prisma schema, by name. */
function readPrismaEnums(): ReadonlyMap<string, readonly string[]> {
  const enums = new Map<string, readonly string[]>();
  for (const file of readdirSync(SCHEMA_DIR).filter((name) => name.endsWith('.prisma'))) {
    const source = readFileSync(join(SCHEMA_DIR, file), 'utf8');
    for (const match of source.matchAll(/^enum\s+(\w+)\s*\{([^}]*)\}/gm)) {
      const [, name, body] = match;
      const members = body!
        .split('\n')
        .map((line) => line.replace(/\/\/.*$/, '').trim())
        .filter((line) => line.length > 0 && /^\w+$/.test(line));
      enums.set(name!, members);
    }
  }
  return enums;
}

const PRISMA_ENUMS = readPrismaEnums();

/**
 * Every mirrored pair. `shared` is the option list as the shared package
 * declares it; `prisma` names the enum in packages/database/prisma/schema.
 */
const MIRRORS: readonly { label: string; shared: readonly string[]; prisma: string }[] = [
  // permissions/index.ts. Not z.enum, but the same mirror: ALL_ROLES is the
  // role list the api validates against, so it must hold every Prisma value.
  { label: 'ALL_ROLES', shared: ALL_ROLES, prisma: 'Role' },
];

describe('shared z.enum mirrors match their Prisma enums', () => {
  it('finds the Prisma schema at all', () => {
    // A path that stopped resolving would make every case below vacuously
    // green, which is the one way this file could fail silently.
    expect(PRISMA_ENUMS.size).toBeGreaterThan(3);
  });

  it.each(MIRRORS)('$label has exactly the members of Prisma $prisma', ({ shared, prisma }) => {
    const members = PRISMA_ENUMS.get(prisma);
    expect(members).toBeDefined();
    expect([...shared].sort()).toEqual([...members!].sort());
  });

  /**
   * `Role` is the member vocabulary: it types `updateRole`, so a role added to Prisma fails this until it is
   * added to ROLES as well.
   */
  it('keeps Prisma Role equal to the staff roles', () => {
    expect([...Object.values(ROLES)].sort()).toEqual([...PRISMA_ENUMS.get('Role')!].sort());
  });
});
