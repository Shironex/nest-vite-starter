import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseObjectLiteralKeys } from '@noctcore/lint-meta-rules/prisma';

import type { IMetaContext, IMetaRule, IViolation } from '../../types';

const RULE_ID = 'isolation-canary-coverage';

/** Runtime source of truth for "which models does the boundary isolate?". */
const EXTENSION_PATH = 'apps/api/src/common/database/tenant-scope.extension.ts';
const EXTENSION_EXPORT = 'TENANT_SCOPED_MODELS';

/** Where the killing cases per mutant are recorded. */
const MANIFEST_PATH = 'tools/canary/isolation-canary.json';

/** The mutant that scopes nothing at all; not a model, and always required. */
const PASS_THROUGH_MUTANT = 'all';

interface IManifest {
  readonly mutants?: Record<string, { readonly mustFail?: unknown } | undefined>;
}

/*
 * Why this rule exists.
 *
 * `pnpm canary:isolation` proves the isolation lane bites by running it once per
 * mutant, where a mutant is `TENANT_SCOPED_MODELS` minus one model. That proof
 * is only as wide as the manifest: a model added to the runtime boundary with no
 * manifest entry is never mutated, so nothing ever checks that the lane can see
 * it leak, and the canary would still report every mutant killed.
 *
 * That is the same registry-to-consumer drift `tenant-model-registry-parity`
 * catches between the extension and the ESLint options, so it is caught the same
 * mechanical way, and against the same parsed declaration (this rule imports
 * that parser rather than writing a second one).
 *
 * The canary itself runs the lane 14 times against a database, so it is a
 * release check rather than a per-push one. This rule is the per-push half: it
 * costs a file read and fails the moment a scoped model has no killing case
 * recorded.
 */
export function checkIsolationCanaryCoverage(root: string): IViolation[] {
  const extensionFile = join(root, EXTENSION_PATH);
  const manifestFile = join(root, MANIFEST_PATH);

  if (!existsSync(extensionFile) || !existsSync(manifestFile)) {
    return [
      {
        file: existsSync(extensionFile) ? MANIFEST_PATH : EXTENSION_PATH,
        rule: RULE_ID,
        message: `The tenant-scope extension and ${MANIFEST_PATH} must both exist for the isolation canary to be checkable. Update the paths in tools/lint-meta/rules/config/${RULE_ID}.ts rather than dropping the check.`,
      },
    ];
  }

  const models = parseObjectLiteralKeys(readFileSync(extensionFile, 'utf8'), EXTENSION_EXPORT);
  if (models === null || models.length === 0) {
    // Fail closed: an unparseable registry must never read as "nothing to cover".
    return [
      {
        file: EXTENSION_PATH,
        rule: RULE_ID,
        message: `Could not read the \`${EXTENSION_EXPORT}\` object literal, so the canary manifest cannot be checked against it. The parser is parseObjectLiteralKeys in @noctcore/lint-meta-rules/prisma.`,
      },
    ];
  }

  let manifest: IManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as IManifest;
  } catch (error) {
    return [
      {
        file: MANIFEST_PATH,
        rule: RULE_ID,
        message: `${MANIFEST_PATH} is not valid JSON, so the isolation canary cannot run at all: ${String(error)}`,
      },
    ];
  }

  const mutants = manifest.mutants;
  if (typeof mutants !== 'object' || mutants === null) {
    return [
      {
        file: MANIFEST_PATH,
        rule: RULE_ID,
        message: `${MANIFEST_PATH} has no \`mutants\` object. It maps each scoped model to the isolation-lane cases that must fail once that model is no longer isolated.`,
      },
    ];
  }

  const violations: IViolation[] = [];
  const named = new Set(Object.keys(mutants));

  for (const model of [...models, PASS_THROUGH_MUTANT]) {
    const entry = mutants[model];
    const mustFail = entry?.mustFail;
    if (entry === undefined) {
      violations.push({
        file: MANIFEST_PATH,
        rule: RULE_ID,
        message: `\`${model}\` is isolated by the tenant-scope extension but has no mutant in ${MANIFEST_PATH}, so \`pnpm canary:isolation\` never checks that the isolation lane can see it leak. Add an entry naming the case(s) that must fail without its scope.`,
      });
      continue;
    }
    if (!Array.isArray(mustFail) || mustFail.length === 0) {
      violations.push({
        file: MANIFEST_PATH,
        rule: RULE_ID,
        message: `The \`${model}\` mutant in ${MANIFEST_PATH} names no case in \`mustFail\`, so nothing can catch it. Add the isolation-lane case that goes red once \`${model}\` is unscoped, writing one if the lane has none.`,
      });
    }
  }

  const known = new Set([...models, PASS_THROUGH_MUTANT]);
  for (const model of named) {
    if (!known.has(model)) {
      violations.push({
        file: MANIFEST_PATH,
        rule: RULE_ID,
        message: `\`${model}\` has a mutant in ${MANIFEST_PATH} but is not in \`${EXTENSION_EXPORT}\`, so the canary would set ISOLATION_CANARY_DISABLE_MODEL to a name the seam refuses. Drop the entry, or fix the accessor name.`,
      });
    }
  }

  return violations;
}

/**
 * Every model the tenant-scope extension isolates must have a canary mutant.
 *
 * The isolation canary is only as wide as its manifest: a scoped model with no
 * entry is never mutated, so nothing proves the isolation lane can see it leak.
 */
export const isolationCanaryCoverageRule: IMetaRule = {
  id: RULE_ID,
  category: 'testing',
  ciCritical: true,
  description:
    'Every model in TENANT_SCOPED_MODELS (plus the pass-through mutant) must have a mutant with at least one killing case in tools/canary/isolation-canary.json.',
  run({ root }: IMetaContext): IViolation[] {
    return checkIsolationCanaryCoverage(root);
  },
};
