import { checkArchMap } from '../../../arch/build-map';
import type { IMetaContext, IMetaRule, IViolation } from '../../types';

const RULE_ID = 'arch-map-fresh';

/*
 * The generated module map and exports catalog must match the tree.
 *
 * `apps/web/src/features/README.md` listed seven domains while seventeen
 * directories shipped, and the "cross-module edges" paragraph in
 * `apps/api/src/modules/README.md` was prose nothing compared against the
 * imports. Both were written once and believed for months, because a wrong
 * sentence in a markdown file fails nothing.
 *
 * The map is generated instead (`pnpm generate:arch-map`), and this rule is
 * what makes the generated copy binding: it re-renders both pages from the
 * current tree and reports any difference, plus any module or feature
 * directory with no hand-written purpose line.
 *
 * It compares rendered text rather than running `git diff --exit-code`, which
 * is what the source issue suggested, for one reason: a `git diff` check is
 * wrong on a dirty tree, and the tree is dirty exactly when somebody is adding
 * the module the check exists to catch.
 */

/** The committed module map and exports catalog must match the tree, purpose lines included. */
export const archMapFreshRule: IMetaRule = {
  id: RULE_ID,
  category: 'config',
  ciCritical: true,
  description:
    'The generated module map and exports catalog must match the tree, and every api module and web feature must have a purpose line in tools/arch/registry.ts.',
  run({ root }: IMetaContext): IViolation[] {
    return checkArchMap(root).map((problem) => ({
      file: problem.file,
      rule: RULE_ID,
      message: problem.message,
    }));
  },
};
