import { ESLintUtils } from '@typescript-eslint/utils';

/**
 * Thin wrapper over RuleCreator that attaches a docs URL for this repo's
 * internal rules. The slug is cosmetic; it only surfaces in rule metadata.
 */
export const createRule = ESLintUtils.RuleCreator(
  (ruleName) =>
    `https://github.com/Shironex/nest-vite-saas-starter/blob/main/packages/eslint-plugin-repo/docs/rules/${ruleName}.md`,
);
