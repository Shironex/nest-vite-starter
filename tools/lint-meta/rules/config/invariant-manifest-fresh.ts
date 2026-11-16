import { readFileSync } from 'node:fs';

import { checkManifests } from '../../../invariants/manifest';
import type { IMetaContext, IMetaRule, IViolation } from '../../types';
import { declaredRuleIds } from '../testing/lint-meta-rules-self-covered';

const RULE_ID = 'invariant-manifest-fresh';
const RULES_FRAGMENT = 'tools/lint-meta/rules/';

/**
 * The generated catalog, which lists every rule the registry runs, including the
 * ones adopted from `@noctcore/lint-meta-rules` that have no module here.
 */
const CATALOG_PATH = 'tools/lint-meta/RULES.md';

/*
 * `docs/invariants/*.md` must still describe the tree.
 *
 * The manifests are the checked-in answer to "which invariants does this
 * subsystem have, and what enforces each one", so a review can test the same
 * properties every time instead of whatever the reviewer remembered. That is
 * only worth anything while they are true, and a markdown file naming a rule
 * that is not in the tree is worse than no file: it says the door is guarded
 * when it is not.
 *
 * So the rot check is part of the build. It fails on a glob that matches
 * nothing, an invariant with no `**Enforced by:**` line, a cited lint-meta rule
 * that is not in the tree, a cited ESLint rule that is not configured, a cited
 * path that is gone, and an `unenforced` invariant with no issue or decision
 * next to it.
 *
 * The lint-meta ids come from the rule MODULES in `ctx.sourceFiles` and from the
 * generated catalog, never from `registry.ts`: this module is itself in that
 * registry, so importing it back is a cycle that dies on whichever side loads
 * first. Modules alone stopped being enough once rules began arriving from
 * `@noctcore/lint-meta-rules` with no module here, and the catalog is the one
 * artifact that names every rule the registry runs.
 *
 * It cannot check that an invariant is TRUE. That is review's job, and the
 * manifest exists to tell review where to look.
 */

function toPosix(file: string): string {
  return file.replace(/\\/gu, '/');
}

/** Every rule id declared by a rule module under tools/lint-meta/rules. */
function localRuleIds(sourceFiles: readonly string[]): string[] {
  return sourceFiles.flatMap((file) => {
    const posix = toPosix(file);
    if (!posix.includes(RULES_FRAGMENT) || posix.endsWith('.test.ts')) {
      return [];
    }
    return declaredRuleIds(readFileSync(file, 'utf8'));
  });
}

/*
 * Rule ids from the generated catalog's table. A rule adopted from
 * `@noctcore/lint-meta-rules` has no module in this repo, so scanning modules
 * alone would call a perfectly live rule missing, which is how a true invariant
 * citation would start failing for being upstream. The catalog is the one place
 * that lists every rule the registry actually runs, and `check:lint-meta-docs`
 * fails when it is stale, so reading it here inherits that freshness instead of
 * importing the registry and closing the cycle this module documents above.
 */
function catalogRuleIds(root: string): string[] {
  let markdown: string;
  try {
    markdown = readFileSync(`${root}/${CATALOG_PATH}`, 'utf8');
  } catch {
    return [];
  }
  return [...markdown.matchAll(/^\|\s*`([a-z0-9-]+)`\s*\|/gmu)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

/** Every invariant manifest must cite globs that match and enforcers that exist. */
export const invariantManifestFreshRule: IMetaRule = {
  id: RULE_ID,
  category: 'config',
  ciCritical: true,
  description:
    'Every docs/invariants manifest must have globs that match files and enforcer citations (lint-meta rule, ESLint rule, file) that still exist.',
  run({ root, sourceFiles }: IMetaContext): IViolation[] {
    const lintMetaRuleIds = [...new Set([...localRuleIds(sourceFiles), ...catalogRuleIds(root)])];
    return checkManifests({ root, lintMetaRuleIds }).map((problem) => ({
      file: problem.file,
      rule: RULE_ID,
      message: problem.message,
    }));
  },
};
