import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ESLint } from 'eslint';

import type { IMetaContext, IMetaRule, IViolation } from '../../types';

const RULE_ID = 'log-redaction-denylist-parity';

/** Package whose resolved ESLint config carries the static log denylist. */
const API_PACKAGE_DIR = 'apps/api';

/**
 * A path (relative to the package) inside the glob the logging rules are scoped
 * to. Never read: `calculateConfigForFile` is pure glob matching, the same probe
 * convention as `tenant-model-registry-parity`.
 */
const API_PROBE = 'src/modules/example/example.service.ts';

/** Runtime source of truth for "which key names does the log redactor deny?". */
const PATTERNS_PATH = 'packages/shared/src/logger/index.ts';
const PATTERNS_EXPORT = 'SENSITIVE_KEY_PATTERNS';

/** Where a maintainer edits the static side when this rule fires. */
const CONFIG_PATH = 'packages/eslint-config/nestjs.js';

const LINT_RULE_ID = 'observability/no-sensitive-fields-in-logs';

/*
 * Why this rule exists.
 *
 * `SENSITIVE_KEY_PATTERNS` is the list the runtime redactor and the Sentry
 * scrubber share: a key containing one of those substrings is replaced with
 * [REDACTED] on its way to a log sink. `LOG_DENY_NAMES` in
 * packages/eslint-config/nestjs.js is the STATIC counterpart, handed to
 * `observability/no-sensitive-fields-in-logs` as `denyNames`, so a credential
 * named in a logger call fails the build before it is ever redacted at runtime.
 *
 * They are two hand-kept lists of one policy, and the config cannot import the
 * runtime one: @repo/shared already depends on @repo/eslint-config, so the
 * reverse edge would be a workspace cycle. Nothing made them agree, which is
 * the drift this rule closes: a pattern added to the runtime list with no
 * lint entry is redacted at runtime and invisible to the static guard.
 *
 * The static side is read from the RESOLVED ESLint config, like
 * `tenant-model-registry-parity`, so it asserts what the rule actually receives
 * rather than parsing one const out of nestjs.js.
 */

/** Strip line and block comments, preserving string literals. */
function stripComments(source: string): string {
  let out = '';
  let i = 0;

  while (i < source.length) {
    const char = source[i] ?? '';
    const two = source.slice(i, i + 2);

    if (char === "'" || char === '"' || char === '`') {
      let j = i + 1;
      while (j < source.length && source[j] !== char) {
        j += source[j] === '\\' ? 2 : 1;
      }
      out += source.slice(i, j + 1);
      i = j + 1;
      continue;
    }

    if (two === '//') {
      while (i < source.length && source[i] !== '\n') {
        i += 1;
      }
      continue;
    }

    if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }

    out += char;
    i += 1;
  }

  return out;
}

/**
 * The string entries of the `SENSITIVE_KEY_PATTERNS` array literal, or `null`
 * when the declaration cannot be located (which is reported, never read as an
 * empty list).
 */
function parseRuntimePatterns(source: string): string[] | null {
  const match = new RegExp(`\\b${PATTERNS_EXPORT}\\s*=\\s*\\[([^\\]]*)\\]`, 'u').exec(
    stripComments(source),
  );
  if (match === null) {
    return null;
  }

  return [...(match[1] ?? '').matchAll(/'([^']*)'|"([^"]*)"/gu)].map(
    (entry) => entry[1] ?? entry[2] ?? '',
  );
}

/** The `denyNames` option a resolved rule entry carries, or `null` if absent. */
function readDenyNames(entry: unknown): string[] | null {
  if (!Array.isArray(entry)) {
    return null;
  }
  const options = entry[1];
  if (typeof options !== 'object' || options === null) {
    return null;
  }
  const names = (options as { denyNames?: unknown }).denyNames;
  if (!Array.isArray(names) || !names.every((name) => typeof name === 'string')) {
    return null;
  }
  return names;
}

export async function checkLogRedactionDenylistParity(root: string): Promise<IViolation[]> {
  const patternsFile = join(root, PATTERNS_PATH);
  if (!existsSync(patternsFile)) {
    return [
      {
        file: PATTERNS_PATH,
        rule: RULE_ID,
        message: `The shared logger is missing, so the runtime redaction list cannot be read. Update the path in tools/lint-meta/rules/config/${RULE_ID}.ts.`,
      },
    ];
  }

  const runtime = parseRuntimePatterns(readFileSync(patternsFile, 'utf8'));
  if (runtime === null || runtime.length === 0) {
    // Fail closed: an unparseable list must never read as "nothing is redacted".
    return [
      {
        file: PATTERNS_PATH,
        rule: RULE_ID,
        message: `Could not read the \`${PATTERNS_EXPORT}\` array literal. The parser in tools/lint-meta/rules/config/${RULE_ID}.ts expects \`export const ${PATTERNS_EXPORT} = [ '...', ] as const\`; if the declaration changed shape, update the parser rather than dropping the check.`,
      },
    ];
  }

  const pkgDir = join(root, API_PACKAGE_DIR);
  const eslint = new ESLint({ cwd: pkgDir, errorOnUnmatchedPattern: false });

  let resolved;
  try {
    resolved = await eslint.calculateConfigForFile(join(pkgDir, API_PROBE));
  } catch (error) {
    return [
      {
        file: join(API_PACKAGE_DIR, 'eslint.config.js'),
        rule: RULE_ID,
        message: `Could not resolve the effective ESLint config for "${API_PACKAGE_DIR}" (run \`pnpm build:packages\` so the @repo/eslint-* dist exists): ${String(error)}`,
      },
    ];
  }

  const configured = readDenyNames((resolved.rules ?? {})[LINT_RULE_ID]);
  if (configured === null) {
    return [
      {
        file: CONFIG_PATH,
        rule: RULE_ID,
        message: `"${LINT_RULE_ID}" resolves with no \`denyNames\` option for ${API_PACKAGE_DIR}, so it falls back to the published 7-name default and stops matching most of what the runtime redacts. Pass LOG_DENY_NAMES to it in ${CONFIG_PATH}.`,
      },
    ];
  }

  const violations: IViolation[] = [];
  const configuredSet = new Set(configured);
  const runtimeSet = new Set(runtime);

  for (const pattern of runtime) {
    if (!configuredSet.has(pattern)) {
      violations.push({
        file: CONFIG_PATH,
        rule: RULE_ID,
        message: `'${pattern}' is redacted at runtime (${PATTERNS_EXPORT}) but is MISSING from the \`denyNames\` option of "${LINT_RULE_ID}", so a logger call naming it is not caught before it ships. Add '${pattern}' to LOG_DENY_NAMES in ${CONFIG_PATH}.`,
      });
    }
  }

  for (const name of configured) {
    if (!runtimeSet.has(name)) {
      violations.push({
        file: CONFIG_PATH,
        rule: RULE_ID,
        message: `'${name}' is in the \`denyNames\` option of "${LINT_RULE_ID}" but is MISSING from ${PATTERNS_EXPORT} in ${PATTERNS_PATH}, so lint refuses a name the runtime redactor lets through. Either add it to ${PATTERNS_EXPORT} or drop '${name}' from LOG_DENY_NAMES in ${CONFIG_PATH}.`,
      });
    }
  }

  return violations;
}

/**
 * The static log denylist must mirror the runtime redaction list.
 *
 * `observability/no-sensitive-fields-in-logs` is handed `LOG_DENY_NAMES`, a
 * hand-kept copy of `SENSITIVE_KEY_PATTERNS` (the list the log redactor and the
 * Sentry scrubber share). A pattern in one and not the other is either a secret
 * the runtime redacts and lint never catches, or a name lint refuses that the
 * runtime happily logs.
 */
export const logRedactionDenylistParityRule: IMetaRule = {
  id: RULE_ID,
  category: 'config',
  ciCritical: true,
  description:
    'The observability/no-sensitive-fields-in-logs denyNames option must mirror SENSITIVE_KEY_PATTERNS in the shared logger, the list the runtime redactor uses.',
  runAsync({ root }: IMetaContext): Promise<IViolation[]> {
    return checkLogRedactionDenylistParity(root);
  },
};
