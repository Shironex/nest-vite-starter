import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What a plain `USER` may reach, pinned.
 *
 * WHY THIS FILE EXISTS. Staff invitations are the first time this product has
 * more than one person in an organization, so `USER` stops being a role nobody holds
 * and becomes the role most colleagues hold. Its capability line was never
 * designed: it is the residue of which routers happened to get
 * `AdminMiddleware` as they were written, and the multi-user charting decided to
 * RATIFY it as-is rather than redesign it under time pressure.
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

const ROUTER_ROOT = join(__dirname, '..', '..', '..', 'modules');

/**
 * Routers this pin deliberately says nothing about.
 *
 *   auth, ping:  unauthenticated by design. There is no role to gate on.
 */
const OUT_OF_SCOPE = new Set(['auth', 'ping']);

/**
 * ADMIN-gated procedures out of total, per staff router, as of the multi-user
 * effort. A change to any number is a change to what a colleague can do.
 */
const EXPECTED: Record<string, { gated: number; total: number }> = {
  audit: { gated: 1, total: 1 },
  dataExport: { gated: 0, total: 1 },
  workspaces: { gated: 2, total: 3 },
  notifications: { gated: 0, total: 5 },
  sessions: { gated: 0, total: 3 },
  staffInvite: { gated: 3, total: 3 },
  storage: { gated: 0, total: 3 },
  twoFactor: { gated: 3, total: 9 },
  // 9, not 8: user.tenant was added (the sidebar's organization identity block).
  // Deliberately ungated: every colleague, any role, needs to see the name
  // of the organization they are in, not just an ADMIN.
  user: { gated: 6, total: 9 },
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

  it('keeps every access GRANT admin-only, which is the one line that is designed', () => {
    // The rest of the split is inherited. This part is not: handing somebody a
    // login or a role is reserved for an ADMIN everywhere it appears, and that
    // is the invariant worth stating separately from the counts above.
    for (const alias of ['staffInvite']) {
      const router = ROUTERS.find((entry) => entry.alias === alias)!;
      expect(router.gated).toBe(router.total);
    }
  });
});
