#!/usr/bin/env node
/*
 * Claude Code PreToolUse hook (Edit|Write|MultiEdit): deny an edit that ADDS a
 * pattern the gate already rejects, so the agent hears about it at write time
 * instead of one gate round trip later.
 *
 * It adds no policy. Each check mirrors a gate rule:
 *   no-inline-lint-disable, no-ts-ignore  lint-meta (regexes imported, not copied)
 *   @typescript-eslint/no-explicit-any    packages/eslint-config/base.js (as any only)
 *   no-empty                              eslint recommended (empty catch only)
 *
 * Scope is exactly the files lint-meta scans (isSourceFilePath) minus generated
 * output (isGenerated), so tools/, docs, markdown and scripts are never touched.
 * Matches are COUNTED in the new text against the text it replaces, so moving an
 * existing line is not blocked; only a net increase is.
 *
 * Deny protocol: exit 0 with hookSpecificOutput.permissionDecision = "deny" on
 * stdout. Any internal failure allows the edit (a broken guard must not wedge
 * the session; the gate still catches everything).
 *
 * Node type stripping (unflagged since 22.18, engines >=22.22.3) lets this .mjs
 * import the lint-meta .ts modules directly.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isSourceFilePath } from '../../tools/lint-meta/context.ts';
import {
  INLINE_DISABLE,
  INLINE_DISABLE_MESSAGE,
  TS_SUPPRESSION,
  TS_SUPPRESSION_MESSAGE,
  isGenerated,
} from '../../tools/lint-meta/rules/source-text/forbidden-text.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/*
 * `as any` followed by a code delimiter, so prose ("as any developer knows")
 * passes. Hooks receive decoded strings: a line end is a real newline (`$` under
 * the `m` flag), and the text may simply end after `any`. `as any as T`,
 * `as any[]` and `as any // note` are casts too.
 */
const AS_ANY = /\bas\s+any(?=\s*(?:[)\]},;>|&=[]|\/\/|$)|\s+as\b)/u;
const EMPTY_CATCH = /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/u;

const CHECKS = [
  { rule: 'no-inline-lint-disable', pattern: INLINE_DISABLE, message: INLINE_DISABLE_MESSAGE },
  { rule: 'no-ts-ignore', pattern: TS_SUPPRESSION, message: TS_SUPPRESSION_MESSAGE },
  {
    rule: '@typescript-eslint/no-explicit-any',
    pattern: AS_ANY,
    ignoreCommentLines: true,
    message:
      '`as any` is not allowed. Use `unknown` and narrow it, or give the value its real type.',
  },
  {
    rule: 'no-empty',
    pattern: EMPTY_CATCH,
    message:
      'Empty catch block. Handle or rethrow the error, or put a comment inside the block saying why ignoring it is safe.',
  },
];

const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/u;

function countMatches(text, check) {
  const source = check.ignoreCommentLines
    ? text
        .split('\n')
        .filter((line) => !COMMENT_LINE.test(line))
        .join('\n')
    : text;

  return source.match(new RegExp(check.pattern.source, 'gmu'))?.length ?? 0;
}

function readIfExists(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

/** The (old, new) text pairs one tool call writes. */
function editPairs(toolName, toolInput, absFile) {
  if (toolName === 'Write') {
    return [{ before: readIfExists(absFile), after: String(toolInput.content ?? '') }];
  }
  if (toolName === 'MultiEdit') {
    return (toolInput.edits ?? []).map((edit) => ({
      before: String(edit.old_string ?? ''),
      after: String(edit.new_string ?? ''),
    }));
  }
  if (toolName === 'Edit') {
    return [
      { before: String(toolInput.old_string ?? ''), after: String(toolInput.new_string ?? '') },
    ];
  }

  return [];
}

/**
 * @param {{ tool_name?: string, tool_input?: Record<string, unknown> }} input parsed hook payload
 * @param {string} [root] repo root (tests point this at a fixture tree)
 * @returns {string | null} the deny reason, or null to allow
 */
export function evaluate(input, root = REPO_ROOT) {
  const toolInput = input.tool_input ?? {};
  const filePath = toolInput.file_path;
  if (typeof filePath !== 'string') {
    return null;
  }

  const absFile = isAbsolute(filePath) ? filePath : resolve(root, filePath);
  const rel = relative(root, absFile).split(sep).join('/');
  if (rel.startsWith('..') || !isSourceFilePath(rel) || isGenerated(absFile.split(sep).join('/'))) {
    return null;
  }

  const pairs = editPairs(input.tool_name, toolInput, absFile);
  const problems = [];

  for (const check of CHECKS) {
    const added = pairs.reduce(
      (sum, { before, after }) => sum + countMatches(after, check) - countMatches(before, check),
      0,
    );
    if (added > 0) {
      problems.push(`[${check.rule}] ${check.message}`);
    }
  }

  if (problems.length === 0) {
    return null;
  }

  return [
    `Blocked edit to ${rel}: it adds a pattern the gate rejects.`,
    ...problems,
    'This hook mirrors the gate (turbo lint, pnpm lint:meta); the edit was not applied.',
  ].join('\n');
}

function main() {
  try {
    const reason = evaluate(JSON.parse(readFileSync(0, 'utf8')));
    if (reason) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: reason,
          },
        }),
      );
    }
  } catch {
    // Fail open: never wedge a session on a hook fault.
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
