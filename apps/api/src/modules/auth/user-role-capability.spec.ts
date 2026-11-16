import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What a plain `USER` may reach, pinned.
 *
 * WHY THIS FILE EXISTS. `USER` is the role most accounts hold. Its capability
 * line was never designed: it is the residue of which routers happened to get
 * `AdminMiddleware` as they were written, and it was RATIFIED as-is rather than
 * redesigned under time pressure.
 *
 * A ratified accident still has to be defended, or it drifts. This test does not
 * assert that the current split is correct. It asserts that it is what somebody
 * decided, so widening a `USER`'s reach becomes an explicit edit to a number
 * here, reviewed on its own terms, instead of a side effect of forgetting a
 * decorator on a new procedure.
 *
 * Static rather than reflective on purpose: nestjs-trpc middleware metadata is
 * an implementation detail of that package, and a pin that breaks on its next
 * minor release stops being a pin and starts being noise.
 */

const ROUTER_ROOT = join(__dirname, '..');

/**
 * Routers this pin deliberately says nothing about.
 *
 *   auth, ping:  unauthenticated by design. There is no role to gate on.
 */
const OUT_OF_SCOPE = new Set(['auth', 'ping']);

/**
 * ADMIN-gated procedures out of total, per router. A change to any number is a change to what a plain user can do.
 */
const EXPECTED: Record<string, { gated: number; total: number }> = {
  audit: { gated: 1, total: 1 },
  dataExport: { gated: 0, total: 1 },
  sessions: { gated: 0, total: 3 },
  twoFactor: { gated: 1, total: 7 },
  // The one ungated user procedure is `me`.
  user: { gated: 7, total: 8 },
};

interface IRouterGating {
  alias: string;
  gated: number;
  total: number;
}

function routerFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...routerFiles(full));
    else if (full.endsWith('.router.ts')) found.push(full);
  }
  return found;
}

/**
 * Count a router's procedures and how many of them an ADMIN guard stands in
 * front of.
 *
 * A procedure's decorators are the contiguous run of lines from its
 * `@Query`/`@Mutation` down to its method signature, so the guard is looked for
 * in exactly that window rather than anywhere in the file. A class-level
 * `AdminMiddleware` counts for every procedure in the class.
 */
function gatingOf(source: string): IRouterGating | null {
  const alias = /@Router\(\{\s*alias:\s*'([^']+)'/.exec(source)?.[1];
  if (alias === undefined) return null;

  const classMiddlewares = /@Router\([^)]*\)\s*@UseMiddlewares\(([^)]*)\)/s.exec(source)?.[1] ?? '';
  const classGated = classMiddlewares.includes('AdminMiddleware');

  const lines = source.split('\n');
  let gated = 0;
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*@(Query|Mutation)\(/.test(lines[i]!)) continue;
    total += 1;
    let window = '';
    for (let j = i; j < lines.length; j++) {
      const line = lines[j]!;
      window += `${line}\n`;
      if (!/^\s*@/.test(line) && /^\s*(async\s+)?[a-zA-Z_$][\w$]*\s*\(/.test(line)) break;
    }
    if (classGated || window.includes('AdminMiddleware')) gated += 1;
  }
  return { alias, gated, total };
}

const ROUTERS = routerFiles(ROUTER_ROOT)
  .map((file) => gatingOf(readFileSync(file, 'utf8')))
  .filter((router): router is IRouterGating => router !== null)
  .filter((router) => !OUT_OF_SCOPE.has(router.alias));

describe('what a plain USER may reach, as ratified rather than designed', () => {
  it('finds every staff router, so a whole router cannot slip past this pin', () => {
    expect(ROUTERS.map((router) => router.alias).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.entries(EXPECTED))(
    '%s keeps the ADMIN gating somebody signed off on',
    (alias, expected) => {
      const actual = ROUTERS.find((router) => router.alias === alias);

      expect(actual).toBeDefined();
      expect({ gated: actual!.gated, total: actual!.total }).toEqual(expected);
    },
  );

  it('keeps every role GRANT admin-only, which is the one line that is designed', () => {
    // The rest of the split is inherited. This part is not: handing somebody a
    // role is reserved for an ADMIN, and that is the invariant worth stating
    // separately from the counts above.
    const source = readFileSync(join(ROUTER_ROOT, 'user', 'user.router.ts'), 'utf8');
    const roleChange = /((?:\s*@[^\n]*\n)+)\s*async updateUserRole\(/.exec(source);
    expect(roleChange?.[1]).toContain('AdminMiddleware');
  });
});
