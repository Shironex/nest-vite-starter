import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

/*
 * Reading and checking `docs/invariants/*.md`.
 *
 * The manifests exist because the worst bugs break invariants rather than
 * code paths, and in each case the invariant was real but written down nowhere
 * a reviewer would find it: a session re-issue path could drop a flag the
 * original mint carried, the tenant scope could escape through a transaction, and "enforce it at
 * every door" updated three doors out of four.
 *
 * A prose list of invariants rots exactly like the prose module map did, so
 * the format is deliberately machine-checkable and the check is a lint-meta
 * rule:
 *
 *   - every `globs:` entry must match at least one file, so a manifest for a
 *     subsystem that has been moved or deleted fails instead of misleading;
 *   - every invariant heading must carry one `Enforced by:` line;
 *   - every enforcer citation must still exist: a lint-meta rule id must be
 *     registered, an ESLint rule id must be configured, a file path must be on
 *     disk. A manifest naming a deleted rule is exactly the failure the whole
 *     idea is about;
 *   - `unenforced` is a legal citation and the honest one, but it must carry an
 *     issue number or a decision link, so a gap is tracked rather than shrugged
 *     at.
 */

const MANIFEST_DIR = 'docs/invariants';

/** Directories no glob should ever have to reach into. */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.turbo',
  'coverage',
  '.git',
  '.agent-state',
  '.next',
  'build',
]);

/** `- **Enforced by:** ...` under an invariant heading. */
const ENFORCED_BY = /^\s*-?\s*\*\*Enforced by:\*\*\s*(.+)$/u;

/** A citation: `lint-meta:id`, `eslint:plugin/rule`, `file:path`, or `unenforced`. */
const CITATION = /`(lint-meta|eslint|file|unenforced):?([^`]*)`/gu;

/** An `unenforced` citation must point at an issue or a written decision. */
const FOLLOW_UP = /#\d+|docs\/[\w./-]+/u;

export interface IManifestProblem {
  readonly file: string;
  readonly message: string;
}

export interface IInvariant {
  readonly title: string;
  readonly line: number;
  readonly enforcers: readonly string[];
  readonly enforcedByLine: string | null;
}

export interface IManifest {
  /** Repo-relative POSIX path. */
  readonly file: string;
  readonly subsystem: string | null;
  readonly globs: readonly string[];
  readonly invariants: readonly IInvariant[];
}

function toPosix(value: string): string {
  return value.split(sep).join(posix.sep);
}

/**
 * The frontmatter fields the check needs: `subsystem` and the `globs` list.
 *
 * A two-field reader rather than a YAML dependency, because the manifests are
 * written to this shape and a richer frontmatter would be a richer thing to
 * keep in sync.
 */
export function parseFrontmatter(source: string): { subsystem: string | null; globs: string[] } {
  const match = /^---\n([\s\S]*?)\n---/u.exec(source);
  if (match === null) {
    return { subsystem: null, globs: [] };
  }

  const globs: string[] = [];
  let subsystem: string | null = null;
  let inGlobs = false;

  for (const raw of (match[1] ?? '').split('\n')) {
    const subsystemMatch = /^subsystem:\s*(.+)$/u.exec(raw);
    if (subsystemMatch?.[1] !== undefined) {
      subsystem = subsystemMatch[1].trim().replace(/^['"]|['"]$/gu, '');
      inGlobs = false;
      continue;
    }

    if (/^globs:\s*$/u.test(raw)) {
      inGlobs = true;
      continue;
    }

    const item = /^\s+-\s*(.+)$/u.exec(raw);
    if (inGlobs && item?.[1] !== undefined) {
      globs.push(item[1].trim().replace(/^['"]|['"]$/gu, ''));
      continue;
    }

    if (/^\S/u.test(raw)) {
      inGlobs = false;
    }
  }

  return { subsystem, globs };
}

export function parseManifest(file: string, source: string): IManifest {
  const { subsystem, globs } = parseFrontmatter(source);
  const lines = source.split('\n');
  const invariants: IInvariant[] = [];

  for (const [index, line] of lines.entries()) {
    const heading = /^###\s+(.+)$/u.exec(line);
    if (heading?.[1] === undefined) {
      continue;
    }

    let enforcedByLine: string | null = null;

    for (const candidate of lines.slice(index + 1)) {
      if (/^#{1,3}\s/u.test(candidate)) {
        break;
      }
      const enforced = ENFORCED_BY.exec(candidate);
      if (enforced?.[1] !== undefined) {
        enforcedByLine = enforced[1];
        break;
      }
    }

    const enforcers =
      enforcedByLine === null
        ? []
        : [...enforcedByLine.matchAll(CITATION)].map((match) =>
            match[2] === '' ? (match[1] ?? '') : `${match[1]}:${match[2]}`,
          );

    invariants.push({ title: heading[1].trim(), line: index + 1, enforcers, enforcedByLine });
  }

  return { file, subsystem, globs, invariants };
}

export function listManifests(root: string): IManifest[] {
  const dir = join(root, ...MANIFEST_DIR.split('/'));
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.md') && entry !== 'README.md')
    .sort()
    .map((entry) => {
      const file = `${MANIFEST_DIR}/${entry}`;
      return parseManifest(file, readFileSync(join(dir, entry), 'utf8'));
    });
}

/** A glob over repo-relative POSIX paths, supporting `**`, `*` and `?`. */
export function globToRegExp(glob: string): RegExp {
  let pattern = '';

  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];

    if (char === '*') {
      if (glob[index + 1] === '*') {
        const slash = glob[index + 2] === '/';
        pattern += slash ? '(?:[^/]+/)*' : '.*';
        index += slash ? 2 : 1;
        continue;
      }
      pattern += '[^/]*';
      continue;
    }

    pattern += char === '?' ? '[^/]' : (char ?? '').replace(/[.+^${}()|[\]\\]/u, '\\$&');
  }

  return new RegExp(`^${pattern}$`, 'u');
}

function listRepoFiles(root: string): string[] {
  const out: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        out.push(toPosix(relative(root, full)));
      }
    }
  };

  walk(root);
  return out;
}

/** ESLint rule ids this repo configures, read from the shared config package. */
function configuredEslintRules(root: string): Set<string> {
  const configDir = join(root, 'packages', 'eslint-config');
  const ids = new Set<string>();

  if (!existsSync(configDir)) {
    return ids;
  }

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(?:js|mjs|cjs|ts)$/u.test(entry.name)) {
        continue;
      }
      for (const match of readFileSync(full, 'utf8').matchAll(/'([\w@/-]+\/[\w-]+)':/gu)) {
        if (match[1] !== undefined) {
          ids.add(match[1]);
        }
      }
    }
  };

  walk(configDir);
  return ids;
}

export interface ICheckInput {
  readonly root: string;
  /** Rule ids registered in tools/lint-meta/registry.ts. */
  readonly lintMetaRuleIds: readonly string[];
}

export function checkManifests({ root, lintMetaRuleIds }: ICheckInput): IManifestProblem[] {
  const manifests = listManifests(root);
  if (manifests.length === 0) {
    return [];
  }

  const problems: IManifestProblem[] = [];
  const files = listRepoFiles(root);
  const metaRules = new Set(lintMetaRuleIds);
  const eslintRules = configuredEslintRules(root);

  for (const manifest of manifests) {
    if (manifest.subsystem === null) {
      problems.push({
        file: manifest.file,
        message:
          'Frontmatter has no `subsystem:` line, so nothing names what this manifest covers.',
      });
    }

    if (manifest.globs.length === 0) {
      problems.push({
        file: manifest.file,
        message:
          'Frontmatter has no `globs:` list. A reviewer loads a manifest by matching its globs against the diff, so a manifest with none is never loaded.',
      });
    }

    for (const glob of manifest.globs) {
      const pattern = globToRegExp(glob);
      if (!files.some((candidate) => pattern.test(candidate))) {
        problems.push({
          file: manifest.file,
          message: `Glob \`${glob}\` matches no file. The subsystem moved or the path is wrong; fix the glob or retire the manifest.`,
        });
      }
    }

    if (manifest.invariants.length === 0) {
      problems.push({
        file: manifest.file,
        message: 'No invariants. Each one is a `### ` heading with an `**Enforced by:**` line.',
      });
    }

    for (const invariant of manifest.invariants) {
      if (invariant.enforcedByLine === null) {
        problems.push({
          file: manifest.file,
          message: `Invariant "${invariant.title}" (line ${invariant.line}) has no \`**Enforced by:**\` line. Name the rule, the fence or the spec, or say \`unenforced\` with the issue that tracks it.`,
        });
        continue;
      }

      if (invariant.enforcers.length === 0) {
        problems.push({
          file: manifest.file,
          message: `Invariant "${invariant.title}" (line ${invariant.line}) has an \`**Enforced by:**\` line with no citation. Use \`lint-meta:<id>\`, \`eslint:<id>\`, \`file:<path>\` or \`unenforced\`.`,
        });
        continue;
      }

      for (const enforcer of invariant.enforcers) {
        const [kind, ...rest] = enforcer.split(':');
        const value = rest.join(':');

        if (kind === 'unenforced') {
          if (!FOLLOW_UP.test(invariant.enforcedByLine)) {
            problems.push({
              file: manifest.file,
              message: `Invariant "${invariant.title}" (line ${invariant.line}) is \`unenforced\` with no follow-up. Add the issue number that tracks it, or a link to the decision not to fix it.`,
            });
          }
          continue;
        }

        if (kind === 'lint-meta' && !metaRules.has(value)) {
          problems.push({
            file: manifest.file,
            message: `Invariant "${invariant.title}" (line ${invariant.line}) cites lint-meta rule \`${value}\`, which is not in tools/lint-meta/registry.ts.`,
          });
          continue;
        }

        if (kind === 'eslint' && !eslintRules.has(value)) {
          problems.push({
            file: manifest.file,
            message: `Invariant "${invariant.title}" (line ${invariant.line}) cites ESLint rule \`${value}\`, which packages/eslint-config does not configure.`,
          });
          continue;
        }

        if (kind === 'file' && !existsSync(join(root, ...value.split('/')))) {
          problems.push({
            file: manifest.file,
            message: `Invariant "${invariant.title}" (line ${invariant.line}) cites \`${value}\`, which does not exist.`,
          });
        }
      }
    }
  }

  return problems;
}
