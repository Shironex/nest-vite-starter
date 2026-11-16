import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, posix, relative, resolve, sep } from 'node:path';

/*
 * Reading the module graph off the tree.
 *
 * Two hand-kept maps drifted before this existed: the "Domains" table in
 * apps/web/src/features/README.md listed seven of seventeen feature folders,
 * and the "Cross-module edges" paragraph in apps/api/src/modules/README.md was
 * prose checked by nothing. Prose has no compiler. Everything on this page is
 * derived from the imports instead, so the only way it can be wrong is if the
 * imports are.
 *
 * Every cross-unit edge carries a witness (`file:line`), because an edge with
 * no witness is an assertion and an edge with one is a fact a reader can open.
 */

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage']);

/*
 * Tests, stories and the port contract suites are left out of both the counts
 * and the edges. A spec wires up collaborators from half the repo on purpose,
 * so counting its imports would make every module look coupled to every other
 * and would put a spec file in the witness column of a production edge. The
 * graph is about what SHIPS.
 */
const NON_SHIPPING_FILE = /\.(?:spec|test|stories|contract-suite)\.tsx?$/u;

/** `from '<spec>'`, `import '<spec>'` and `import('<spec>')`, single or double quoted. */
const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/gu;

/** Where an edge was seen: a repo-relative POSIX path and a 1-based line. */
export interface IWitness {
  readonly file: string;
  readonly line: number;
}

export interface IEdge {
  readonly to: string;
  /** Every import that creates this edge, sorted by file then line. */
  readonly witnesses: readonly IWitness[];
}

export interface IUnit {
  readonly name: string;
  /** Shipping source files (.ts/.tsx) under the unit directory; tests excluded. */
  readonly files: number;
  /** Units this one imports from (fan-out), sorted by name. */
  readonly dependsOn: readonly IEdge[];
  /** Units that import this one (fan-in), sorted by name. */
  readonly dependents: readonly string[];
}

export interface IUnitGroup {
  readonly id: string;
  /** Repo-relative POSIX directory whose subdirectories are the units. */
  readonly dir: string;
  /** Import prefix that names a unit directly, for example `@/modules/`. */
  readonly aliasPrefix?: string;
  readonly units: readonly IUnit[];
}

export interface IGroupSpec {
  readonly id: string;
  readonly dir: string;
  readonly aliasPrefix?: string;
}

/** The two graphs this repo has: backend modules and frontend feature domains. */
export const GROUP_SPECS: readonly IGroupSpec[] = [
  { id: 'api-modules', dir: 'apps/api/src/modules', aliasPrefix: '@/modules/' },
  { id: 'web-features', dir: 'apps/web/src/features', aliasPrefix: '@/features/' },
];

function toPosix(value: string): string {
  return value.split(sep).join(posix.sep);
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];

  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }

  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);

    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) {
        out.push(...listSourceFiles(full));
      }
      continue;
    }

    if (stat.isFile() && SOURCE_EXTENSIONS.has(extname(full)) && !NON_SHIPPING_FILE.test(entry)) {
      out.push(full);
    }
  }

  return out.sort();
}

function listUnitNames(groupDir: string): string[] {
  let entries: string[];

  try {
    entries = readdirSync(groupDir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() && !SKIP_DIRS.has(entry.name) ? [entry.name] : [],
    );
  } catch {
    return [];
  }

  return entries.sort();
}

/**
 * The unit a specifier points at, or null when it stays inside the importing
 * unit or leaves the group entirely (`common/`, a package, a node builtin).
 */
export function resolveUnit(
  specifier: string,
  fromFile: string,
  groupDirAbsolute: string,
  aliasPrefix: string | undefined,
): string | null {
  if (aliasPrefix !== undefined && specifier.startsWith(aliasPrefix)) {
    return specifier.slice(aliasPrefix.length).split('/')[0] ?? null;
  }

  if (!specifier.startsWith('.')) {
    return null;
  }

  const target = resolve(dirname(fromFile), specifier);
  const within = toPosix(relative(groupDirAbsolute, target));

  if (within === '' || within.startsWith('..') || within.startsWith('/')) {
    return null;
  }

  return within.split('/')[0] ?? null;
}

interface IRawEdge {
  readonly from: string;
  readonly to: string;
  readonly witness: IWitness;
}

function collectEdges(
  root: string,
  groupDirAbsolute: string,
  unit: string,
  aliasPrefix: string | undefined,
  files: readonly string[],
): IRawEdge[] {
  const edges: IRawEdge[] = [];

  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');

    for (const [index, line] of lines.entries()) {
      IMPORT_SPECIFIER.lastIndex = 0;

      for (const match of line.matchAll(IMPORT_SPECIFIER)) {
        const specifier = match[1];
        if (specifier === undefined) {
          continue;
        }

        const target = resolveUnit(specifier, file, groupDirAbsolute, aliasPrefix);
        if (target === null || target === unit) {
          continue;
        }

        edges.push({
          from: unit,
          to: target,
          witness: { file: toPosix(relative(root, file)), line: index + 1 },
        });
      }
    }
  }

  return edges;
}

export function scanGroup(root: string, spec: IGroupSpec): IUnitGroup {
  const groupDirAbsolute = join(root, ...spec.dir.split('/'));
  const names = listUnitNames(groupDirAbsolute);
  const known = new Set(names);

  const fileCounts = new Map<string, number>();
  const rawEdges: IRawEdge[] = [];

  for (const name of names) {
    const files = listSourceFiles(join(groupDirAbsolute, name));
    fileCounts.set(name, files.length);
    rawEdges.push(...collectEdges(root, groupDirAbsolute, name, spec.aliasPrefix, files));
  }

  const units = names.map((name) => {
    const byTarget = new Map<string, IWitness[]>();

    for (const edge of rawEdges) {
      // A specifier can name a directory that is not a unit (a loose file next
      // to the units). Only edges between two real units are reported.
      if (edge.from !== name || !known.has(edge.to)) {
        continue;
      }
      const witnesses = byTarget.get(edge.to) ?? [];
      witnesses.push(edge.witness);
      byTarget.set(edge.to, witnesses);
    }

    const dependsOn: IEdge[] = [...byTarget.entries()]
      .map(([to, witnesses]) => ({
        to,
        witnesses: [...witnesses].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
      }))
      .sort((a, b) => a.to.localeCompare(b.to));

    const dependents = [
      ...new Set(
        rawEdges
          .filter((edge) => edge.to === name && known.has(edge.from))
          .map((edge) => edge.from),
      ),
    ].sort();

    return { name, files: fileCounts.get(name) ?? 0, dependsOn, dependents };
  });

  return spec.aliasPrefix === undefined
    ? { id: spec.id, dir: spec.dir, units }
    : { id: spec.id, dir: spec.dir, aliasPrefix: spec.aliasPrefix, units };
}

export function scanGroups(root: string, specs: readonly IGroupSpec[] = GROUP_SPECS): IUnitGroup[] {
  return specs.map((spec) => scanGroup(root, spec));
}
