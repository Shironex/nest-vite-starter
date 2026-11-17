import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { IMetaCtx, IMetaRule, IViolation } from '@noctcore/harness';
import { ESLint } from 'eslint';

const RULE_ID = 'required-rules-at-error';
const RAW_SQL_RULE_ID = 'raw-sql-allowlist-pinned';
const RAW_SQL_ESLINT_RULE = 'noctcore-prisma/no-raw-sql-outside-allowlist';
const THIS_FILE = 'tools/lint-meta/rules/required-rules-at-error.ts';

/** Normalize an ESLint severity (number | string | [severity, ...opts]) to 0/1/2. */
function severityToNumber(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === 1 || raw === 'warn') return 1;
  if (raw === 2 || raw === 'error') return 2;
  return 0;
}

export interface IRequiredRule {
  /** ESLint rule id as it appears in the resolved config. */
  readonly ruleId: string;
  /** Package directory, relative to the repo root. */
  readonly packageDir: string;
  /**
   * A path (relative to the package) matching the glob the rule is scoped to.
   * The file need not exist: `calculateConfigForFile` is pure glob matching.
   */
  readonly probe: string;
  /** Why losing this rule matters, quoted back to whoever broke it. */
  readonly rationale: string;
}

const API_PROBE = 'src/modules/user/user.service.ts';

/*
 * The security rules, pinned at "error" in the RESOLVED config.
 *
 * A rule wired only in a config file is one careless edit away from being
 * dropped, and dropping it is silent: the config still parses, lint still
 * passes, and the guarantee is gone. `eslint-config-no-warn` cannot tell a rule
 * deliberately set to "off" from one someone deleted; this table can.
 */
export const REQUIRED_RULES: readonly IRequiredRule[] = [
  {
    ruleId: 'noctcore-security/no-shell-interpolation',
    packageDir: 'apps/api',
    probe: API_PROBE,
    rationale: 'An interpolated command string handed to a shell runner is command injection.',
  },
  {
    ruleId: 'noctcore-security/no-timing-unsafe-compare',
    packageDir: 'apps/api',
    probe: API_PROBE,
    rationale:
      'An HMAC or signature compared with === leaks how much of a forgery was right; crypto.timingSafeEqual does not.',
  },
  {
    ruleId: 'noctcore-security/no-user-controlled-redirect',
    packageDir: 'apps/api',
    probe: API_PROBE,
    rationale: 'A redirect whose origin is a runtime value is an open redirect.',
  },
  {
    ruleId: 'noctcore-security/require-path-containment',
    packageDir: 'apps/api',
    probe: API_PROBE,
    rationale: 'Request input passed straight into path.join / path.resolve is path traversal.',
  },
  {
    ruleId: 'noctcore-security/no-user-controlled-fetch-url',
    packageDir: 'apps/web',
    probe: 'src/features/auth/api.ts',
    rationale: 'A request whose origin is not fixed at authoring time is an SSRF sink.',
  },
  {
    ruleId: 'noctcore-prisma/no-request-body-in-write',
    packageDir: 'apps/api',
    probe: API_PROBE,
    rationale:
      'A write whose data or where is the raw request lets the caller set any column (mass assignment).',
  },
  {
    ruleId: 'noctcore-prisma/mutation-entry-must-reach-audit',
    packageDir: 'apps/api',
    probe: API_PROBE,
    rationale:
      'It is the only check that a mutation audits at all. The tree passes it today, so its absence would look identical to its success until an unaudited mutation ships.',
  },
  {
    ruleId: RAW_SQL_ESLINT_RULE,
    packageDir: 'apps/api',
    probe: API_PROBE,
    rationale:
      'Every model-level guard (soft-delete filter, select allowlists, parameter binding) lives on the Prisma model, and a raw query has none.',
  },
];

/*
 * The files where raw SQL that names a table is allowed. Widening the list in
 * packages/eslint-config/nestjs.js alone fails this check: the change has to
 * land here too, so it is reviewed as a security change, not a lint tweak.
 */
export const RAW_SQL_ALLOWLIST: readonly string[] = [
  '**/prisma/seed.ts',
  '**/*.seed.ts',
  '**/prisma/migrations/**',
  '**/*.isolation.spec.ts',
];

type ResolvedRules = Readonly<Record<string, unknown>>;

/**
 * The resolved rules for one probe file, or the violation that explains why
 * they could not be read. Fails closed: an unresolvable config never reads as
 * "rule present".
 */
async function resolveRules(
  root: string,
  packageDir: string,
  probe: string,
  ruleId: string,
): Promise<ResolvedRules | IViolation> {
  const pkgDir = join(root, packageDir);
  if (!existsSync(pkgDir)) {
    return {
      file: packageDir,
      rule: ruleId,
      message: `Package "${packageDir}" does not exist, so its ESLint config cannot be verified. Update ${THIS_FILE}.`,
    };
  }
  // A fresh instance per package: flat config is single-rooted and does not
  // look downward from the repo root.
  const eslint = new ESLint({ cwd: pkgDir, errorOnUnmatchedPattern: false });
  try {
    const resolved = (await eslint.calculateConfigForFile(join(pkgDir, probe))) as {
      rules?: ResolvedRules;
    };
    return resolved.rules ?? {};
  } catch (error) {
    return {
      file: packageDir,
      rule: ruleId,
      message: `Could not resolve the effective ESLint config for "${packageDir}": ${String(error)}`,
    };
  }
}

function isViolation(value: ResolvedRules | IViolation): value is IViolation {
  return typeof (value as IViolation).rule === 'string' && 'message' in value;
}

async function checkRequiredRule(rule: IRequiredRule, root: string): Promise<IViolation | null> {
  const rules = await resolveRules(root, rule.packageDir, rule.probe, RULE_ID);
  if (isViolation(rules)) return rules;

  const severity = severityToNumber(rules[rule.ruleId]);
  if (severity === 2) return null;

  const state = severity === 1 ? 'warn' : 'off or absent';
  return {
    file: rule.packageDir,
    rule: RULE_ID,
    message: `Rule "${rule.ruleId}" must resolve to "error" for ${rule.packageDir}/${rule.probe}, but it is ${state}. ${rule.rationale}`,
  };
}

export async function checkRequiredRulesAtError(
  root: string,
  table: readonly IRequiredRule[] = REQUIRED_RULES,
): Promise<IViolation[]> {
  const results = await Promise.all(table.map((rule) => checkRequiredRule(rule, root)));
  return results.filter((violation): violation is IViolation => violation !== null);
}

export async function checkRawSqlAllowlist(
  root: string,
  pinned: readonly string[] = RAW_SQL_ALLOWLIST,
): Promise<IViolation[]> {
  const rules = await resolveRules(root, 'apps/api', API_PROBE, RAW_SQL_RULE_ID);
  if (isViolation(rules)) return [rules];

  const entry = rules[RAW_SQL_ESLINT_RULE];
  const options: unknown = Array.isArray(entry) ? entry[1] : undefined;
  const allowed = (options as { allowedFiles?: unknown } | undefined)?.allowedFiles;
  const actual = Array.isArray(allowed) ? allowed.map(String) : [];
  const extra = actual.filter((glob) => !pinned.includes(glob));
  if (extra.length === 0) return [];

  return [
    {
      file: 'packages/eslint-config/nestjs.js',
      rule: RAW_SQL_RULE_ID,
      message: `The raw SQL allowlist (${RAW_SQL_ESLINT_RULE} allowedFiles) has entries that are not pinned in ${THIS_FILE}: ${extra.join(', ')}. A raw query bypasses every model-level guard, so a new allowed file is a security review: add it to RAW_SQL_ALLOWLIST in the same change.`,
    },
  ];
}

/** The security ESLint rules stay at "error" in the resolved config. */
export const requiredRulesAtErrorRule: IMetaRule = {
  id: RULE_ID,
  category: 'config',
  ciCritical: true,
  description:
    'The security ESLint rules (shell, timing, redirect, path, fetch, mass assignment, audit, raw SQL) must resolve to "error".',
  runAsync({ root }: IMetaCtx): Promise<IViolation[]> {
    return checkRequiredRulesAtError(root);
  },
};

/** The raw SQL allowlist cannot grow without a matching change here. */
export const rawSqlAllowlistPinnedRule: IMetaRule = {
  id: RAW_SQL_RULE_ID,
  category: 'config',
  ciCritical: true,
  description:
    'The raw SQL allowlist (no-raw-sql-outside-allowlist allowedFiles) may only name files pinned in RAW_SQL_ALLOWLIST.',
  runAsync({ root }: IMetaCtx): Promise<IViolation[]> {
    return checkRawSqlAllowlist(root);
  },
};
