import { readFileSync } from 'node:fs';

import type { IMetaContext, IMetaRule, IViolation } from '../../types';

/*
 * Every workflow must declare a top-level `permissions:` block so the
 * GITHUB_TOKEN is least-privilege instead of inheriting the repo default
 * (often read/write). Pinning of `uses:` refs is a separate supply-chain
 * concern, checked by `github-actions-sha-pinned`.
 */
export function checkWorkflowPermissions(file: string): IViolation[] {
  const text = readFileSync(file, 'utf8');

  if (/^permissions\s*:/mu.test(text)) {
    return [];
  }

  return [
    {
      file,
      rule: 'github-actions-permissions',
      message:
        'Workflow is missing a top-level `permissions:` block. Declare least-privilege token scopes (e.g. `permissions:\\n  contents: read`).',
    },
  ];
}

/** Every GitHub Actions workflow must declare a top-level permissions block. */
export const githubActionsPermissionsRule: IMetaRule = {
  id: 'github-actions-permissions',
  category: 'ci',
  ciCritical: true,
  description: 'GitHub Actions workflows must declare a top-level permissions block.',
  run({ workflowFiles }: IMetaContext): IViolation[] {
    return workflowFiles.flatMap(checkWorkflowPermissions);
  },
};
