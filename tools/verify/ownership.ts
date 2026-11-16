import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Every container, database and evidence file this harness creates is tagged
 * with the worktree that owns it. The tag is sha256 of the REAL path, so two
 * checkouts of the same repo (and a symlinked path to one of them) never share
 * a sandbox, and `sandbox:down` can select its own containers by label instead
 * of by name pattern or a global prune.
 */
export const LABEL_OWNER = 'saas-starter.sandbox.owner';
export const LABEL_ID = 'saas-starter.sandbox.id';
export const LABEL_ROLE = 'saas-starter.sandbox.role';

/** Stable id for the worktree at `root`: sha256 of its resolved path. */
export function ownerId(root: string): string {
  return createHash('sha256').update(realpathSync(root)).digest('hex');
}

/** Gitignored state directory. Holds sandbox descriptors and verify evidence. */
export function agentStateDir(root: string): string {
  return join(root, '.agent-state');
}

export function sandboxesDir(root: string): string {
  return join(agentStateDir(root), 'sandboxes');
}

export function verificationDir(root: string): string {
  return join(agentStateDir(root), 'verification');
}

/** Captured branch baselines, one file per base commit. See baseline-cli.ts. */
export function baselinesDir(root: string): string {
  return join(agentStateDir(root), 'baselines');
}
