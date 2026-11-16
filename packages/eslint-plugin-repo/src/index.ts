import type { TSESLint } from '@typescript-eslint/utils';

import { recommendedRules } from './configs/recommended';
import { rules } from './rules';

type RepoPlugin = TSESLint.FlatConfig.Plugin & {
  configs: Record<string, TSESLint.FlatConfig.Config>;
};

const plugin: RepoPlugin = {
  meta: {
    name: '@repo/eslint-plugin-repo',
    version: '0.0.0',
  },
  rules,
  configs: {},
};

// Short name `repo` so rules read `repo/job-name-must-be-constant` in flat config.
plugin.configs.recommended = {
  plugins: {
    repo: plugin,
  },
  rules: recommendedRules,
};

export {
  HAND_SCOPED_MODELS,
  HAND_SCOPE_PENDING,
  SOFT_DELETE_ALLOW_IN_FUNCTIONS,
  SOFT_DELETE_MODELS,
  TENANT_MODELS,
  TENANT_WHERE_ALLOW_IN,
  UNSCOPED_BY_DESIGN,
} from './utils/tenant-registry';
export { rules };
export const configs = plugin.configs;
export default plugin;
