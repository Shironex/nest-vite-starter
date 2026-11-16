import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import type { IMetaContext, IMetaRule, IViolation } from '../../types';

const RULE_ID = 'lint-meta-rules-self-covered';

/*
 * Every directory that holds rule modules. `tools/starter` is here because
 * `config-surface-complete` shipped there with a test and was never registered:
 * a rule outside the scanned directories is invisible to this check and to the
 * registry test that uses this list, so it ran nowhere and nothing said so.
 */
export const RULE_MODULE_DIRS: readonly string[] = [
  join('tools', 'lint-meta', 'rules'),
  join('tools', 'starter'),
];

/*
 * Every lint-meta rule needs a test that proves it bites.
 *
 * A guardrail with a false negative is trusted and wrong: if a refactor makes
 * `session-epoch-captured` return `[]`, every push stays green while the race
 * it exists for comes back. This is the rule that keeps a new rule from
 * shipping with no test at all.
 *
 * For every rule module under a `RULE_MODULE_DIRS` directory (a non-test file that
 * declares an `IMetaRule`) it requires:
 *
 *   1. a sibling `<name>.test.ts`,
 *   2. a `describe('<rule id>', ...)` block for each rule id the module declares
 *      (`forbidden-text.ts` declares two), and
 *   3. inside that block, at least one assertion that reads a violation (`.rule`,
 *      `.message`, or a `length` compared against a positive number). A block
 *      that only ever asserts `[]` proves the rule stays quiet, never that it
 *      bites.
 *
 * The check is textual, so it cannot prove the assertion is a good one; it stops
 * the cheap failures (no test, a test for some other rule, a test that only
 * covers the clean path) and leaves the rest to review and to the house rule
 * that a test is not coverage until it has failed.
 */

/** A rule module: a non-test source file that declares an `IMetaRule`. */
const RULE_DECLARATION = /:\s*IMetaRule\s*=/u;

/** A test case that expects a violation reads one back, or counts a positive number of them. */
const EXPECTS_VIOLATION =
  /\.(?:rule|message)\b|\.length,\s*[1-9]|\.length\s*>\s*0|\bnotDeepEqual\(/u;

function listTypeScript(dir: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      out.push(...listTypeScript(full));
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }

  return out.sort();
}

/** Source with block and line comments removed, so prose that quotes `id: 'x'` declares nothing. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:'"`\\])\/\/.*$/gmu, '$1');
}

/**
 * The rule ids a module declares: `id: 'x'` literals, and `id: RULE_ID` resolved
 * through its const. Empty for a module that declares no `IMetaRule`.
 */
export function declaredRuleIds(rawSource: string): string[] {
  const source = withoutComments(rawSource);
  if (!RULE_DECLARATION.test(source)) {
    return [];
  }

  const ids = new Set<string>();

  for (const match of source.matchAll(/\bid:\s*'([^']+)'/gu)) {
    if (match[1] !== undefined) {
      ids.add(match[1]);
    }
  }

  if (/\bid:\s*RULE_ID\b/u.test(source)) {
    const constant = /\bRULE_ID\s*=\s*'([^']+)'/u.exec(source)?.[1];
    if (constant !== undefined) {
      ids.add(constant);
    }
  }

  return [...ids];
}

/**
 * The text of the top-level `describe('<id>', ...)` block, up to the next
 * top-level `describe(` (or the end of the file), or null when there is none.
 */
function describeBlock(testSource: string, ruleId: string): string | null {
  const opener = new RegExp(
    `^describe\\(\\s*['"\`]${ruleId.replace(/[/\\^$*+?.()|[\]{}]/gu, '\\$&')}['"\`]`,
    'mu',
  );
  const start = opener.exec(testSource);
  if (start === null) {
    return null;
  }

  const rest = testSource.slice(start.index + start[0].length);
  const next = /^describe\(/mu.exec(rest);
  return next === null ? rest : rest.slice(0, next.index);
}

export function checkLintMetaRulesSelfCovered(root: string): IViolation[] {
  const files = RULE_MODULE_DIRS.map((dir) => join(root, dir))
    .filter((dir) => existsSync(dir))
    .flatMap((dir) => listTypeScript(dir));

  const violations: IViolation[] = [];

  for (const file of files) {
    if (file.endsWith('.test.ts')) {
      continue;
    }

    const source = readFileSync(file, 'utf8');
    const ruleIds = declaredRuleIds(source);
    if (ruleIds.length === 0) {
      continue;
    }

    const display = relative(root, file).split(sep).join('/');
    const testFile = `${file.slice(0, -'.ts'.length)}.test.ts`;
    const testDisplay = relative(root, testFile).split(sep).join('/');

    if (!existsSync(testFile)) {
      violations.push({
        file: display,
        rule: RULE_ID,
        message: `Rule module has no sibling test. Add \`${testDisplay}\` with a fixture that must produce a violation and one that must pass, built on a temp directory (see tools/lint-meta/test-support.ts), never on the live tree.`,
      });
      continue;
    }

    const testSource = readFileSync(testFile, 'utf8');

    for (const ruleId of ruleIds) {
      const block = describeBlock(testSource, ruleId);

      if (block === null) {
        violations.push({
          file: testDisplay,
          rule: RULE_ID,
          message: `\`${testDisplay}\` has no top-level \`describe('${ruleId}', ...)\` block, so nothing says which test covers rule "${ruleId}".`,
        });
        continue;
      }

      if (!EXPECTS_VIOLATION.test(block)) {
        violations.push({
          file: testDisplay,
          rule: RULE_ID,
          message: `The \`describe('${ruleId}', ...)\` block never expects a violation (no assertion on \`.rule\`, \`.message\` or a positive \`length\`). A test that only proves the rule stays quiet passes when the rule is stubbed to return []. Add a fixture the rule must report.`,
        });
      }
    }
  }

  return violations;
}

/** Every rule module in a RULE_MODULE_DIRS directory needs a sibling test that expects a violation. */
export const lintMetaRulesSelfCoveredRule: IMetaRule = {
  id: RULE_ID,
  category: 'testing',
  ciCritical: true,
  description:
    'Every lint-meta rule module must have a sibling *.test.ts with a describe block per rule id and at least one case that expects a violation.',
  run({ root }: IMetaContext): IViolation[] {
    return checkLintMetaRulesSelfCovered(root);
  },
};
