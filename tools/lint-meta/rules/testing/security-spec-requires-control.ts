import type { IMetaContext, IMetaRule, IViolation } from '../../types';
import {
  collectSecuritySpecs,
  flatten,
  isControlTitle,
  readSuites,
  SECURITY_SPEC_DIR,
  type ISpecSource,
  type ITestNode,
} from './security-spec-ast';

const RULE_ID = 'security-spec-requires-control';

/*
 * Every suite owns a positive control.
 *
 * Most security cases assert an ABSENCE: the stranger is refused, no link row
 * is written, no session is minted, the query returns null. Every one of those
 * also passes when the code under test was never reached at all: when the
 * fixture never landed, when the service was stubbed into silence, when a
 * rename left the suite empty. A `control:` case is the one case in the suite
 * that asserts the machinery WORKS, so the absences mean something.
 *
 * The check is structural, on the describe/it tree, because the two cheap ways
 * of getting this wrong are exactly the ones text matching accepts: a control
 * named in a comment, and a control living in a sibling suite further down the
 * file. A suite needs a control of its OWN, and only a suite that directly owns
 * cases needs one (a suite that only groups other suites has nothing to
 * control).
 *
 * Cases at the top level of a file, outside any describe, are reported for the
 * same reason: they belong to no suite, so no control covers them.
 *
 * Scoped to `apps/api/security-spec/`. Extending it to `*.isolation.spec.ts`
 * (where the same vacuous-absence problem was found) is deliberately left as a
 * follow-up: those files need their controls WRITTEN first, and a rule that
 * lands red is a rule somebody turns off.
 */

function ownCases(node: ITestNode): ITestNode[] {
  return node.children.filter((child) => child.kind === 'case');
}

export function checkSecuritySpecRequiresControl(specs: readonly ISpecSource[]): IViolation[] {
  const violations: IViolation[] = [];

  for (const { file, source } of specs) {
    const roots = readSuites(file, source);

    for (const orphan of roots.filter((node) => node.kind === 'case')) {
      violations.push({
        file,
        rule: RULE_ID,
        message: `Line ${String(orphan.line)}: the case "${orphan.title ?? orphan.callee}" sits outside any \`describe\`, so no control covers it. Put it in a suite that owns a \`control:\` case.`,
      });
    }

    for (const suite of flatten(roots).filter((node) => node.kind === 'suite')) {
      const cases = ownCases(suite);
      if (cases.length === 0) {
        continue;
      }

      if (!cases.some((child) => isControlTitle(child.title))) {
        violations.push({
          file,
          rule: RULE_ID,
          message: `Line ${String(suite.line)}: the suite "${suite.title ?? suite.callee}" has ${String(cases.length)} case(s) and no \`control:\` case of its own. Without one, an absence assertion here passes just as well when the code under test is never reached. A control in a comment or in a sibling suite does not count.`,
        });
      }
    }
  }

  return violations;
}

/** Every describe in the security lane owns a `control:` case that must pass. */
export const securitySpecRequiresControlRule: IMetaRule = {
  id: RULE_ID,
  category: 'testing',
  ciCritical: true,
  description: `Every describe in ${SECURITY_SPEC_DIR} must own a \`control:\` case, proving the suite can fail.`,
  run({ root }: IMetaContext): IViolation[] {
    return checkSecuritySpecRequiresControl(collectSecuritySpecs(root));
  },
};
