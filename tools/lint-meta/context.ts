import { spawnSync } from 'node:child_process';
import { existsSync, globSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';

import type { IExecResult, IMetaContext } from './types';

export const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

// Per-workspace subdirs holding first-party source worth scanning.
//
// `security-spec` is apps/api's third test lane (one file per audit finding,
// reconciled against findings.json). It sits outside `src` deliberately, and it
// is exactly the folder where a suppression would do the most damage: a
// security case that `as any`s its way to green looks identical to one that
// proves something. Adding it here is what puts it under the forbidden-text
// rules and, through `isSourceFilePath`, under the Claude Code edit hooks.
const WORKSPACE_SOURCE_SUBDIRS = ['src', 'test', 'tests', 'security-spec'] as const;

// Monorepo roots that contain workspaces.
const WORKSPACE_GROUPS = ['apps', 'packages'] as const;

/*
 * Repo tooling, scanned whole rather than per-subdir: it has no `src`, its
 * files sit directly under `tools/<area>/`.
 *
 * tools/ is product code, not scripts. The lint-meta rules here are the
 * guardrails every other check trusts, so a suppression inside one is a hole in
 * the gate, and until this root was added the text rules could not see it.
 */
const TOOLING_ROOTS = ['tools'] as const;

/*
 * `__lint_edited_probe__` is a transient fixture, not source. The edit-hook test
 * has to write its probe under `apps/api/src` so the real api ESLint policy
 * resolves for it, and it deletes the directory again when it is done. Scanning
 * it means a rule can glob a path and then find it gone a moment later, which is
 * a self-inflicted ENOENT rather than anything about the repo. It has been seen
 * in as many as 1 run out of 3, because `pnpm test:lint-meta`
 * runs that test alongside the codegen test, which invokes `lint:meta`.
 *
 * Excluding it removes the cause for every rule at once. `forbidden-text` also
 * tolerates a vanished file, because a snapshot can always race, but the other
 * rules that read `sourceFiles` still read it directly.
 */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage', '__lint_edited_probe__']);

export function collectSourceFiles(dir: string): string[] {
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
      if (SKIP_DIRS.has(entry)) {
        continue;
      }
      out.push(...collectSourceFiles(full));
      continue;
    }

    if (stat.isFile() && SOURCE_EXTENSIONS.has(extname(full))) {
      out.push(full);
    }
  }

  return out;
}

/*
 * Whether a repo-relative path is WORKSPACE source
 * (`apps|packages/<workspace>/{src,test,tests,security-spec}/**.{ts,tsx}`, minus SKIP_DIRS).
 *
 * This is the editor hooks' scope (scripts/hooks/, documented in CLAUDE.md), a
 * SUBSET of what `buildContext` collects: the hook deliberately stops at the
 * workspaces and leaves `TOOLING_ROOTS` out. tools/ holds the rule tests, whose
 * fixtures carry `eslint-disable` and `@ts-ignore` as DATA for the scanner to
 * report, and a write-time guard cannot tell a fixture from a suppression.
 * `pnpm lint:tools` and `pnpm lint:meta` cover those files instead.
 */
export function isSourceFilePath(relPath: string): boolean {
  const segments = relPath.split('/');
  const [group, workspace, subdir, ...rest] = segments;

  return (
    segments.length >= 4 &&
    (WORKSPACE_GROUPS as readonly string[]).includes(group ?? '') &&
    Boolean(workspace) &&
    (WORKSPACE_SOURCE_SUBDIRS as readonly string[]).includes(subdir ?? '') &&
    SOURCE_EXTENSIONS.has(extname(relPath)) &&
    !rest.some((segment) => SKIP_DIRS.has(segment))
  );
}

function listWorkspaces(root: string): string[] {
  const workspaces: string[] = [];

  for (const group of WORKSPACE_GROUPS) {
    const groupDir = join(root, group);
    let entries: string[];

    try {
      entries = readdirSync(groupDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = join(groupDir, entry);
      if (statSync(full).isDirectory()) {
        workspaces.push(full);
      }
    }
  }

  return workspaces;
}

export function findWorkflows(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];

  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }

  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isFile() && (entry.endsWith('.yml') || entry.endsWith('.yaml'))) {
      out.push(full);
    }
  }

  return out;
}

/*
 * Workflows live at the repository root. Walk up from `root` to the nearest
 * `.github/workflows` so CI rules always scan the workflows that actually run,
 * whether invoked from the repo root or a nested checkout.
 */
export function resolveWorkflowsDir(root: string): string {
  let current = root;

  for (;;) {
    const candidate = join(current, '.github', 'workflows');
    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(current);
    if (parent === current) {
      return join(root, '.github', 'workflows');
    }
    current = parent;
  }
}

/*
 * The `@noctcore/harness` half of the context: `read`, `exists`, `glob`, `exec`,
 * ported from `packages/harness/src/lint-meta/ctx.ts` so a harness-shaped rule
 * reads the tree exactly as it would upstream (see tools/lint-meta/harness.ts).
 *
 * Paths are repo-relative and forward-slashed, reads are LF-normalized so a
 * line-based rule matches on every platform, and `exec` reports a failed
 * command as a code rather than throwing: a rule that shells out must be able
 * to say "the command failed" as a violation instead of dying.
 */

/** How much combined stdout+stderr a rule's `exec` may buffer. */
const EXEC_MAX_BUFFER = 16 * 1024 * 1024;

/** Repo-relative path with forward slashes, the lint-meta path convention. */
function toPosixRelative(rel: string): string {
  return rel.split('\\').join('/');
}

/** Text with CRLF and CR collapsed to LF, so line-based rules match CI. */
function normalizeText(text: string): string {
  return text.replace(/\r\n/gu, '\n').replace(/\r/gu, '\n');
}

function readRelative(root: string, rel: string): string | null {
  const absolute = join(root, toPosixRelative(rel));

  return existsSync(absolute) ? normalizeText(readFileSync(absolute, 'utf8')) : null;
}

function execAtRoot(root: string, cmd: string): IExecResult {
  const result = spawnSync(cmd, {
    cwd: root,
    shell: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: EXEC_MAX_BUFFER,
  });

  return {
    code: typeof result.status === 'number' ? result.status : 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export function buildContext(root: string): IMetaContext {
  const workspaceFiles = listWorkspaces(root).flatMap((workspace) =>
    WORKSPACE_SOURCE_SUBDIRS.flatMap((subdir) => collectSourceFiles(join(workspace, subdir))),
  );
  const toolingFiles = TOOLING_ROOTS.flatMap((dir) => collectSourceFiles(join(root, dir)));
  const sourceFiles = [...workspaceFiles, ...toolingFiles];

  return {
    root,
    sourceFiles,
    workflowFiles: findWorkflows(resolveWorkflowsDir(root)),
    read: (rel) => readRelative(root, rel),
    exists: (rel) => existsSync(join(root, toPosixRelative(rel))),
    glob: (pattern) => [...globSync(pattern, { cwd: root })].map(toPosixRelative),
    exec: (cmd) => execAtRoot(root, cmd),
  };
}
