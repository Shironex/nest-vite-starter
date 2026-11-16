#!/usr/bin/env node
/*
 * Claude Code PostToolUse hook (Edit|Write|MultiEdit): run ESLint on the one
 * file just written and hand any problems back to the model, so a rule
 * violation is fixed while the code is still in context instead of surfacing at
 * `turbo lint` or pre-push.
 *
 * `decision: "block"` on PostToolUse does not undo the write; it feeds `reason`
 * to the model as feedback. Nothing is reported for a clean file.
 *
 * Deliberately narrow:
 *   - ESLint only, on the touched file. No per-write `tsc` (whole-program cost).
 *   - Skips (silently, exit 0) whenever it cannot get a trustworthy answer:
 *     out-of-scope or generated file, ESLint missing, the internal plugin's dist
 *     not built yet (fresh worktree: run `pnpm build:packages`), a config error,
 *     or the run exceeding TIMEOUT_MS. The gate still catches everything.
 *
 * Latency budget is ~5 s (hard skip at 10 s). Measured 2026-09-19 on a 1.2k-line api file: ~0.6 s,
 * on a 640-line web test: 0.8 to 2.7 s (ESLint is not type-aware in this repo
 * today). A run that blows TIMEOUT_MS is killed and skipped, never waited on;
 * re-measure if a type-aware lint block lands.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isGenerated } from '../../tools/lint-meta/rules/source-text/forbidden-text.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// `--timeout-ms=N` exists for tests and loaded machines; the settings.json hook
// timeout must stay comfortably above the default.
const TIMEOUT_ARG = process.argv.find((arg) => arg.startsWith('--timeout-ms='));
const TIMEOUT_MS = Number(TIMEOUT_ARG?.split('=')[1]) || 10_000;
const MAX_REPORTED = 20;

// apps|packages/<workspace>/**.ts|tsx, outside dependency and build output.
const LINTABLE = /^(?:apps|packages)\/[^/]+\/.+\.(?:ts|tsx)$/u;
const SKIPPED_SEGMENT = /(?:^|\/)(?:node_modules|dist|\.turbo|coverage)\//u;

function runEslint(root, workspaceDir, absFile) {
  const bin = join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');
  if (!existsSync(bin)) {
    return null;
  }

  const result = spawnSync(
    process.execPath,
    [bin, '--format', 'json', '--no-warn-ignored', absFile],
    { cwd: workspaceDir, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
  );

  return parseRun(result);
}

/**
 * ESLint results from a finished spawn, or null when the run proves nothing.
 * Exit 0 = clean, 1 = lint errors; anything else (2, timeout, signal) is a
 * tooling problem we do not report as the agent's mistake.
 */
export function parseRun(result) {
  if (result.error || (result.status !== 0 && result.status !== 1)) {
    return null;
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

/** Format ESLint's JSON results as one `line:col rule message` line per problem. */
export function formatProblems(results, root) {
  const lines = [];

  for (const { filePath, messages } of results) {
    for (const message of messages) {
      const rule = message.ruleId ?? (message.fatal ? 'parse-error' : 'eslint');
      lines.push(
        `${relative(root, filePath)}:${message.line}:${message.column} ${rule} ${message.message}`,
      );
    }
  }

  const shown = lines.slice(0, MAX_REPORTED);
  if (lines.length > shown.length) {
    shown.push(`... and ${lines.length - shown.length} more`);
  }

  return shown;
}

/**
 * @param {{ tool_input?: Record<string, unknown> }} input parsed hook payload
 * @param {{ root?: string, run?: typeof runEslint }} [options] test seams
 * @returns {string | null} the feedback for the model, or null when clean or skipped
 */
export function evaluate(input, { root = REPO_ROOT, run = runEslint } = {}) {
  const filePath = input.tool_input?.file_path;
  if (typeof filePath !== 'string') {
    return null;
  }

  const absFile = isAbsolute(filePath) ? filePath : resolve(root, filePath);
  const rel = relative(root, absFile).split(sep).join('/');
  if (
    rel.startsWith('..') ||
    !LINTABLE.test(rel) ||
    SKIPPED_SEGMENT.test(rel) ||
    isGenerated(absFile.split(sep).join('/')) ||
    !existsSync(absFile)
  ) {
    return null;
  }

  const workspaceDir = join(root, ...rel.split('/').slice(0, 2));
  const results = run(root, workspaceDir, absFile);
  if (!results) {
    return null;
  }

  const problems = formatProblems(results, root);
  if (problems.length === 0) {
    return null;
  }

  return [
    `ESLint found ${problems.length} problem(s) in ${rel} (the file was written; fix them now):`,
    ...problems,
  ].join('\n');
}

function main() {
  try {
    const reason = evaluate(JSON.parse(readFileSync(0, 'utf8')));
    if (reason) {
      process.stdout.write(JSON.stringify({ decision: 'block', reason }));
    }
  } catch {
    // Fail open: never wedge a session on a hook fault.
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
