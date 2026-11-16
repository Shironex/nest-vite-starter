import type { IMetaContext, IMetaRule, IViolation } from '../../types';
import {
  callsExpect,
  collectSecuritySpecs,
  flatten,
  readSuites,
  SECURITY_SPEC_DIR,
  ts,
  visitOwnBody,
  type ISpecSource,
} from './security-spec-ast';

const RULE_ID = 'security-spec-no-silent-bail';

/*
 * A security case is either evidence or it is nothing.
 *
 * Every shape below turns a case that proves something into a case that proves
 * nothing, while leaving the suite green and the count unchanged:
 *
 *   - `it.skip` / `xit` / `it.todo`: the case is gone, the file still passes.
 *   - `it.only` / `fit`: every OTHER case is gone, and the file still passes.
 *   - a bare `return` inside the case: "Postgres is not up, never mind", the
 *     exact bail `security-spec/harness.ts` exists to replace with a throw that
 *     the manifest reconciler records as `blocked` rather than as evidence.
 *   - a case body with no `expect` at all: it cannot fail, so it is a green
 *     line in the report and nothing else. An assertion helper counts when it
 *     is NAMED `expect...`, which is how the check sees it without a type
 *     checker.
 *
 * The manifest reconciler catches a skipped case AFTER a run; this catches it
 * before the push, and catches the two shapes a run cannot see at all (a bail
 * that returns early on a day the service happens to be up, and a body that
 * never asserts).
 *
 * Scoped to `apps/api/security-spec/`. The ordinary suites have their own,
 * looser policy (`code-quality/skipped-tests-need-tracking` lets a skip through
 * with an owner and a link); here there is no tracked skip, because a finding
 * whose case is skipped is a finding nobody is watching.
 */

/** Modifiers that remove a case, or remove every other case. */
const BANNED_MODIFIERS = new Set(['skip', 'only', 'todo', 'failing']);
const BANNED_ALIASES = new Set(['xit', 'fit', 'xtest', 'ftest', 'xdescribe', 'fdescribe']);

function bannedCallee(callee: string): string | null {
  const [root, ...rest] = callee.split('.');
  if (BANNED_ALIASES.has(root ?? '')) {
    return root ?? null;
  }
  const modifier = rest.find((part) => BANNED_MODIFIERS.has(part));
  return modifier === undefined ? null : callee;
}

export function checkSecuritySpecNoSilentBail(specs: readonly ISpecSource[]): IViolation[] {
  const violations: IViolation[] = [];

  for (const { file, source } of specs) {
    for (const node of flatten(readSuites(file, source))) {
      const banned = bannedCallee(node.callee);
      if (banned !== null) {
        violations.push({
          file,
          rule: RULE_ID,
          message: `Line ${String(node.line)}: \`${banned}\` is not allowed in the security lane. A skipped case is an unproven finding and a focused one silently drops the rest; delete the case and its manifest row, or fix it.`,
        });
      }

      if (node.kind !== 'case' || node.body === null) {
        continue;
      }

      visitOwnBody(node.body, (child) => {
        if (ts.isReturnStatement(child) && child.expression === undefined) {
          violations.push({
            file,
            rule: RULE_ID,
            message: `Line ${String(node.line)}: the case "${node.title ?? node.callee}" returns early without asserting. A missing precondition is not a pass: throw \`specPrecondition(...)\` from security-spec/harness.ts so the run records it as blocked.`,
          });
        }
      });

      if (!callsExpect(node.body)) {
        violations.push({
          file,
          rule: RULE_ID,
          message: `Line ${String(node.line)}: the case "${node.title ?? node.callee}" calls no \`expect\`, so it cannot fail. Assert in the case, or call a helper named \`expect...\` so the assertion is visible here.`,
        });
      }
    }
  }

  return violations;
}

/** No skips, no focus, no early returns and no assertion-free cases in the security lane. */
export const securitySpecNoSilentBailRule: IMetaRule = {
  id: RULE_ID,
  category: 'testing',
  ciCritical: true,
  description: `Security specs (${SECURITY_SPEC_DIR}) may not skip, focus, bail early or assert nothing.`,
  run({ root }: IMetaContext): IViolation[] {
    return checkSecuritySpecNoSilentBail(collectSecuritySpecs(root));
  },
};
