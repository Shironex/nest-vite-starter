import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { IMetaContext, IMetaRule, IViolation } from '../../types';
import { toPosix } from './source-scope';

/*
 * The module edge rules from apps/api/src/modules/README.md, as data.
 *
 * Three rules, each with its own shape of allowance:
 *
 * The DIRECTION table (FORBIDDEN_DIRECTIONS: which feature module may not
 * import which) has no allowance at all.
 * It is what makes the feature graph a DAG, and the tree satisfies it, so
 * there is nothing to grandfather.
 *
 * The FOREIGN REPOSITORY rule allows a type-only import. A type binds nothing
 * at run time, so it cannot create the module cycle the rule guards against;
 * a value import of another module's repository can.
 *
 * The FOREIGN SUBDIRECTORY rule needs the platform-versus-feature distinction
 * the README's prose already makes, which PLATFORM_ENTRY_POINTS holds. Thirty
 * six of the forty four reaches in the tree go into the `auth` leaf modules,
 * and those leaves exist precisely so a router can guard itself without
 * importing AuthModule and reopening a cycle: naming a subdirectory is the only
 * way to reach them. Without that distinction the rule would report the pattern
 * it is supposed to sanction.
 *
 * The ten edges that remained when the rule landed are paid, through public
 * entry points and ports each module owns. EDGE_EXCEPTIONS
 * is empty, so any new break is red. Should one ever be recorded, an entry
 * whose import is absent from the tree is reported too, so the table shrinks
 * as the debt is paid rather than widening the rule permanently.
 *
 * Only non-spec source is scanned. A spec builds whatever fixture it needs out
 * of whatever module defines the type, and policing that would report test
 * scaffolding as an architecture break.
 */

const RULE_ID = 'api-module-edges';

/** Where the module graph lives. A path outside it is not this rule's business. */
const MODULES_ROOT = 'apps/api/src/modules/';

/**
 * The direction table (README "Platform modules versus feature modules"): a
 * module may not import from any module listed against it. Zero breaks when
 * the rule landed, and it is the reason the graph is a DAG rather than a set of
 * comments claiming it is one.
 *
 * `workspace` is the platform Organization -> Workspace tier, below every domain module: the
 * domain imports it for the Workspace gate, and it stays whole in a product built
 * on this code only while it imports none of them back.
 */
const FORBIDDEN_DIRECTIONS: Readonly<Record<string, readonly string[]>> = {
  // Add each domain module here as it is built: `workspace: ['orders']`, and the
  // order between domain modules, so the graph stays a DAG.
};

interface IEntryPoint {
  /** Module-relative directory, e.g. `auth/middleware`. */
  readonly path: string;
  readonly reason: string;
}

/**
 * Subdirectories another module MAY reach into: the platform leaves.
 *
 * These are not exceptions to the rule, they are the half of it the prose
 * carried and the table did not. `modules/auth` is platform and feature at
 * once, and its platform half lives in leaf modules precisely so a router can
 * guard itself without importing AuthModule and reopening a cycle. Every import
 * of that half necessarily names a subdirectory.
 */
const PLATFORM_ENTRY_POINTS: readonly IEntryPoint[] = [
  {
    path: 'auth/middleware',
    reason:
      'AuthMiddleware and RoleMiddleware: the guards every router wires. Importing AuthModule to get them pulls in login, 2FA and the account flows and reopens a cycle.',
  },
  {
    path: 'auth/services',
    reason:
      'SessionService, LockoutService and the two-factor enrollment reader: the session platform, reached from events/, user/ and the download ticket seams.',
  },
];

export type EdgeRule = 'foreign-repository' | 'foreign-subdirectory';

export interface IEdgeException {
  /** Module-relative path of the importing file, e.g. `storage/storage.router.ts`. */
  readonly from: string;
  /** Module-relative path the specifier resolves to, without its extension. */
  readonly to: string;
  readonly rule: EdgeRule;
  readonly reason: string;
}

/**
 * The breaks that existed when the rule landed, each named with its reason.
 *
 * Nothing is added here to make new code compile. An entry is a recorded debt:
 * it says the edge is known, why it has not moved yet, and where it should go.
 */
const EDGE_EXCEPTIONS: readonly IEdgeException[] = [];

/** Stands in for the modules directory while resolving, so an escape from it is detectable. */
const FAKE_ROOT = '/__api_modules__';

/**
 * `import ... from '<relative>'` and `export ... from '<relative>'`, in either quote style.
 *
 * The clause stops at a `;`. With `[\s\S]*?` a match that began at a
 * NON-relative import ran on to the next relative specifier, so the clause of
 * `import type { X } from 'pkg';` swallowed the value import after it, and the
 * leading `type` made that value import of a foreign repository read as
 * type-only and pass.
 */
const RELATIVE_EDGE = /(?:^|\n)[ \t]*(?:import|export)\s+([^;]*?)\sfrom\s*['"](\.[^'"]+)['"]/gu;

/** Files whose imports say nothing about the module graph. */
const NOT_PRODUCTION = /\.(?:spec|test)\.ts$/u;

interface IEdge {
  /** Module-relative path of the importing file. */
  readonly from: string;
  /** Module-relative path the specifier resolves to, extension stripped. */
  readonly to: string;
  readonly fromModule: string;
  readonly toModule: string;
  readonly typeOnly: boolean;
  readonly specifier: string;
}

/**
 * Whether an import clause binds types alone.
 *
 * Both forms: `import type { X } from` and `import { type X, type Y } from`.
 * A clause mixing a value with a type is a value import, which is the answer
 * that matters here: a type import binds nothing at run time, so it cannot
 * create the module cycle the repository rule is about.
 */
export function isTypeOnlyClause(clause: string): boolean {
  const trimmed = clause.trim();
  if (/^type\b/u.test(trimmed)) {
    return true;
  }

  const braces = /^\{([\s\S]*)\}$/u.exec(trimmed);
  if (braces === null) {
    return false;
  }

  const members = (braces[1] ?? '')
    .split(',')
    .map((member) => member.trim())
    .filter((member) => member !== '');

  return members.length > 0 && members.every((member) => /^type\b/u.test(member));
}

/** Every cross-module edge a file declares, module-relative and extension-free. */
export function edgesOf(modulesRelativePath: string, source: string): IEdge[] {
  const edges: IEdge[] = [];
  const fromDir = dirname(modulesRelativePath);

  for (const match of source.matchAll(RELATIVE_EDGE)) {
    const clause = match[1] ?? '';
    const specifier = match[2] ?? '';

    // A fake root deep enough that `..` escaping the module graph is visible
    // rather than silently clamped: `../../common/database/prisma.service` from
    // a module file lands OUTSIDE it, and common/ is not a module.
    const resolved = toPosix(resolve(FAKE_ROOT, fromDir, specifier));
    if (!resolved.startsWith(`${FAKE_ROOT}/`)) {
      continue;
    }

    const to = resolved.slice(FAKE_ROOT.length + 1).replace(/\.tsx?$/u, '');
    const fromModule = modulesRelativePath.split('/')[0] ?? '';
    const toModule = to.split('/')[0] ?? '';

    if (fromModule === '' || toModule === '' || fromModule === toModule) {
      continue;
    }

    edges.push({
      from: modulesRelativePath,
      to,
      fromModule,
      toModule,
      typeOnly: isTypeOnlyClause(clause),
      specifier,
    });
  }

  return edges;
}

function isExcepted(edge: IEdge, rule: EdgeRule, exceptions: readonly IEdgeException[]): boolean {
  return exceptions.some(
    (entry) => entry.rule === rule && entry.from === edge.from && entry.to === edge.to,
  );
}

function entryPointFor(edge: IEdge): IEntryPoint | undefined {
  return PLATFORM_ENTRY_POINTS.find((entry) => edge.to.startsWith(`${entry.path}/`));
}

/** The part of a cross-module target below the module directory. */
function depthBelowModule(edge: IEdge): number {
  return edge.to.split('/').length - 1;
}

/**
 * `exceptions` defaults to the real table. A test passes its own, because the
 * real one is empty and the stale-entry check still has to be proven.
 */
export function checkApiModuleEdges(
  sourceFiles: readonly string[],
  exceptions: readonly IEdgeException[] = EDGE_EXCEPTIONS,
): IViolation[] {
  const violations: IViolation[] = [];
  const edges: IEdge[] = [];
  const scannedFiles = new Set<string>();

  for (const file of sourceFiles) {
    const posix = toPosix(file);
    const at = posix.indexOf(MODULES_ROOT);
    if (at === -1 || NOT_PRODUCTION.test(posix)) {
      continue;
    }

    const relative = posix.slice(at + MODULES_ROOT.length);
    scannedFiles.add(relative);
    edges.push(...edgesOf(relative, readFileSync(file, 'utf8')));
  }

  for (const edge of edges) {
    const where = `${MODULES_ROOT}${edge.from}`;

    if ((FORBIDDEN_DIRECTIONS[edge.fromModule] ?? []).includes(edge.toModule)) {
      violations.push({
        file: where,
        rule: RULE_ID,
        message: `Direction: \`${edge.fromModule}\` must not import from \`${edge.toModule}\` (\`${edge.specifier}\`). Imports run down the direction table (FORBIDDEN_DIRECTIONS) and never back; see apps/api/src/modules/README.md. Move the shared value down the graph, or invert the call through a port.`,
      });
      continue;
    }

    if (
      /\.repository$/u.test(edge.to) &&
      !edge.typeOnly &&
      !isExcepted(edge, 'foreign-repository', exceptions)
    ) {
      violations.push({
        file: where,
        rule: RULE_ID,
        message: `Foreign repository: \`${edge.specifier}\` value-imports another module's repository. Repositories are a module's internals; reach \`${edge.toModule}\` through its service or a \`.port\`. A type-only import is allowed, and a deliberate break is an entry in EDGE_EXCEPTIONS with its reason.`,
      });
      continue;
    }

    if (
      depthBelowModule(edge) > 1 &&
      entryPointFor(edge) === undefined &&
      !isExcepted(edge, 'foreign-subdirectory', exceptions)
    ) {
      violations.push({
        file: where,
        rule: RULE_ID,
        message: `Foreign subdirectory: \`${edge.specifier}\` reaches inside \`${edge.toModule}\`. Cross-module values come through \`${edge.toModule}/${edge.toModule}.public.ts\` and behavior through the module's exports or a \`.port\`. The sanctioned platform entry points are ${PLATFORM_ENTRY_POINTS.map((entry) => `\`${entry.path}\``).join(', ')}; anything else is an entry in EDGE_EXCEPTIONS with its reason.`,
      });
    }
  }

  // A paid debt must leave the table. The file has to still be in the scan for
  // this to mean anything: in a fixture tree it is not there at all, and an
  // exception for a file nobody wrote is not stale, it is irrelevant.
  for (const entry of exceptions) {
    if (!scannedFiles.has(entry.from)) {
      continue;
    }
    if (edges.some((edge) => edge.from === entry.from && edge.to === entry.to)) {
      continue;
    }

    violations.push({
      file: `${MODULES_ROOT}${entry.from}`,
      rule: RULE_ID,
      message: `Stale EDGE_EXCEPTIONS entry: \`${entry.from}\` no longer imports \`${entry.to}\`, so its ${entry.rule} exception is dead. Delete the entry in tools/lint-meta/rules/source-text/api-module-edges.ts.`,
    });
  }

  return violations;
}

/** The README's module direction, foreign-repository and foreign-subdirectory rules. */
export const apiModuleEdgesRule: IMetaRule = {
  id: RULE_ID,
  category: 'source-text',
  ciCritical: true,
  description:
    'apps/api module edges follow the README: no import against the module direction table, no value import of a foreign repository, no reach into a foreign subdirectory outside the platform entry points.',
  run({ sourceFiles }: IMetaContext): IViolation[] {
    return checkApiModuleEdges(sourceFiles);
  },
};
