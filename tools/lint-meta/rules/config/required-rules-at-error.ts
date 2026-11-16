import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { ESLint } from 'eslint';

import type { IMetaContext, IMetaRule, IViolation } from '../../types';

const RULE_ID = 'required-rules-at-error';

/** Normalize an ESLint severity (number | string | [severity, ...opts]) to 0/1/2. */
function severityToNumber(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === 1 || raw === 'warn') return 1;
  if (raw === 2 || raw === 'error') return 2;
  return 0;
}

interface IRequiredRule {
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

/*
 * Rules that guard an invariant no test can catch, pinned at "error".
 *
 * A rule wired only in a config file is one careless edit away from being
 * dropped, and dropping it is silent: the config still parses, lint still
 * passes, and the guarantee is simply gone. Every entry here therefore protects
 * something whose absence shows up only much later, in production data.
 *
 * This complements `eslint-config-no-warn`, which asserts that nothing resolves
 * to "warn". That rule cannot see the difference between a rule deliberately set
 * to "off" and a rule someone deleted, which is exactly the difference that
 * matters for these.
 */
const REQUIRED_RULES: readonly IRequiredRule[] = [
  {
    ruleId: 'noctcore-prisma/mutation-entry-must-reach-audit',
    packageDir: 'apps/api',
    // A production file inside the type-aware block this rule lives in, which
    // is narrower than the other Prisma fences: it ignores specs and test dirs.
    probe: 'src/modules/example/example.service.ts',
    rationale:
      'It is the only check that a mutation audits AT ALL. The similarly named no-audit-write-in-transaction polices where an audit write sits, not whether one exists, which is how four mutation entry points reached production auditing nothing. Downgrading this rule would be invisible: the tree passes it today, so its absence looks identical to its success until a new unaudited mutation ships. Its two exemptions carry their reasons in packages/eslint-config/nestjs.js.',
  },
  {
    ruleId: 'noctcore-prisma/restrict-model-writes',
    packageDir: 'apps/api',
    probe: 'src/modules/example/example.service.ts',
    rationale:
      'It carries the single-writer fences: a model whose invariant spans several rows gets one owner, and only that owner (plus seeds and migrations) may write it. There are none yet, so the rule is inert, and it stays wired at error so that the first restriction added to SINGLE_WRITER_FENCES in packages/eslint-config/nestjs.js is enforced without anyone having to remember to switch it on.',
  },
  {
    ruleId: 'noctcore-prisma/no-raw-sql-outside-allowlist',
    packageDir: 'apps/api',
    probe: 'src/modules/example/example.service.ts',
    rationale:
      'Every model-level guard (the soft-delete filter, the select allowlists, parameter binding) lives on the Prisma model, and a raw query has none. Without this rule a raw SELECT that forgets `deletedAt`, or interpolates caller input, type-checks and trips no other guard.',
  },
  {
    ruleId: 'repo/effect-fired-mutation-must-bind-callbacks',
    packageDir: 'apps/web',
    probe: 'src/features/admin/components/Example/Example.hooks.ts',
    rationale:
      'TanStack Query delivers a per-call `mutate(vars, { onSuccess })` handler only while the issuing observer still has listeners. An effect-fired probe is ref-guarded against a duplicate request, so once a remount detaches that observer there is no second call either: the screen holds its spinner forever with the failure path swallowed too, which means no retry control and no error anywhere. The verify-email and reset-password screens fire this way, and they are exactly the screens a locked-out person reaches.',
  },
  {
    ruleId: 'repo/trpc-invalidate-with-path-key',
    packageDir: 'apps/web',
    probe: 'src/features/admin/Example.mutations.ts',
    rationale:
      "An input-less `queryKey()` is `[path, { type: 'query' }]` and prefix-matches no infinite query, so an `invalidateQueries` written with it goes silently dead the day its procedure moves to `useInfiniteQuery`: the mutation reaches the server and the row on screen never changes. The compliance agenda shipped exactly that, and only the merged-tree e2e caught it. `pathKey()` reaches every entry of the procedure.",
  },
];

async function checkRequiredRule(rule: IRequiredRule, root: string): Promise<IViolation[]> {
  const pkgDir = join(root, rule.packageDir);
  if (!existsSync(pkgDir)) {
    return [
      {
        file: rule.packageDir,
        rule: RULE_ID,
        message: `Package "${rule.packageDir}" does not exist, so rule "${rule.ruleId}" cannot be verified. Update the REQUIRED_RULES table in tools/lint-meta/rules/config/required-rules-at-error.ts.`,
      },
    ];
  }

  // A fresh instance per package: flat config is single-rooted and does not
  // look downward from the repo root.
  const eslint = new ESLint({ cwd: pkgDir, errorOnUnmatchedPattern: false });

  let resolved;
  try {
    resolved = await eslint.calculateConfigForFile(join(pkgDir, rule.probe));
  } catch (error) {
    // Fail closed: an unresolvable config must not read as "rule present".
    return [
      {
        file: join(rule.packageDir, 'eslint.config.js'),
        rule: RULE_ID,
        message: `Could not resolve the effective ESLint config for "${rule.packageDir}" (run \`pnpm build:packages\` so the @repo/eslint-* dist exists): ${String(error)}`,
      },
    ];
  }

  const severity = severityToNumber((resolved.rules ?? {})[rule.ruleId]);
  if (severity === 2) return [];

  const state = severity === 1 ? 'warn' : 'off or absent';
  return [
    {
      file: join(rule.packageDir, 'eslint.config.js'),
      rule: RULE_ID,
      message: `Rule "${rule.ruleId}" must resolve to "error" for ${rule.packageDir}/${rule.probe}, but it is ${state}. ${rule.rationale}`,
    },
  ];
}

export async function checkRequiredRulesAtError(root: string): Promise<IViolation[]> {
  const results = await Promise.all(REQUIRED_RULES.map((rule) => checkRequiredRule(rule, root)));
  return results.flat();
}

/**
 * Invariant-guarding ESLint rules must stay enabled at "error".
 *
 * Checks the RESOLVED flat config, so a rule dropped from a spread preset is
 * caught even though the package's own config file never mentioned it.
 */
export const requiredRulesAtErrorRule: IMetaRule = {
  id: RULE_ID,
  category: 'config',
  ciCritical: true,
  description: 'Invariant-guarding ESLint rules must stay enabled at "error".',
  runAsync({ root }: IMetaContext): Promise<IViolation[]> {
    return checkRequiredRulesAtError(root);
  },
};
