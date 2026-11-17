import type { IMetaCtx, IMetaRule, IViolation } from '@noctcore/harness';

const RULE_ID = 'tsconfig-strict';
const BASE = 'packages/tsconfig/base.json';

/** The flags the shared base turns on, which every project inherits. */
export const BASE_FLAGS: readonly string[] = [
  'strict',
  'noUncheckedIndexedAccess',
  'exactOptionalPropertyTypes',
];

/*
 * The strictness family. `strict` is an umbrella, so turning off one of its
 * members (strictNullChecks, noImplicitAny, ...) in a single project loosens
 * that project silently while the base still reads strict.
 */
const STRICT_FAMILY =
  /"(strict[A-Za-z]*|noImplicit[A-Za-z]*|noUncheckedIndexedAccess|exactOptionalPropertyTypes|useUnknownInCatchVariables|alwaysStrict)"\s*:\s*false\b/gu;

const TSCONFIG_GLOBS = [
  'tsconfig*.json',
  'apps/*/tsconfig*.json',
  'packages/*/tsconfig*.json',
  'tools/tsconfig*.json',
];

/** `text` with `//` and block comments removed (tsconfig is JSONC). */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:"])\/\/.*$/gmu, '$1');
}

export function checkTsconfigStrict(ctx: IMetaCtx): IViolation[] {
  const violations: IViolation[] = [];

  const base = ctx.read(BASE);
  if (base === null) {
    return [
      { file: BASE, rule: RULE_ID, message: `${BASE} is missing; every project extends it.` },
    ];
  }
  const baseText = stripComments(base);
  for (const flag of BASE_FLAGS) {
    if (!new RegExp(`"${flag}"\\s*:\\s*true\\b`, 'u').test(baseText)) {
      violations.push({
        file: BASE,
        rule: RULE_ID,
        message: `${BASE} must set "${flag}": true. It is the type-safety floor every project inherits.`,
      });
    }
  }

  const files = [...new Set(TSCONFIG_GLOBS.flatMap((glob) => ctx.glob(glob)))].sort();
  for (const file of files) {
    const text = ctx.read(file);
    if (text === null) continue;
    for (const match of stripComments(text).matchAll(STRICT_FAMILY)) {
      violations.push({
        file,
        rule: RULE_ID,
        message: `"${match[1] ?? ''}": false loosens type checking for this project. Fix the type errors instead, or narrow the code that needs it.`,
      });
    }
  }

  return violations;
}

/** No tsconfig may turn a strictness flag off, and the base keeps them on. */
export const tsconfigStrictRule: IMetaRule = {
  id: RULE_ID,
  category: 'config',
  ciCritical: true,
  description: `${BASE} keeps ${BASE_FLAGS.join(', ')} on, and no tsconfig sets a strictness flag to false.`,
  run: checkTsconfigStrict,
};
