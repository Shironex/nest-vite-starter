import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { IMetaContext, IMetaRule, IViolation } from '../../types';

/*
 * Packages that must never appear in a workspace manifest, and why.
 *
 * This exists for dependencies that something else will try to reinstall behind
 * your back. A plain code review catches a hand-written `pnpm add`; it does not
 * catch a CLI that writes the dependency itself and leaves the developer with a
 * dirty manifest they did not author.
 */
const BANNED: Readonly<Record<string, string>> = {
  '@react-email/ui':
    "Banned: it is the sole importer of next, which drags in a large tree of Dependabot advisories (and a vulnerable transitive sharp) for a preview UI. react-email's `email dev` CLI offers to reinstall it when you run the preview script. Accepting locally is fine; committing it is not.",
};

const MANIFEST_DIRS = ['apps', 'packages', 'tools'] as const;
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

function findManifests(root: string): string[] {
  const manifests: string[] = [join(root, 'package.json')];

  for (const group of MANIFEST_DIRS) {
    const groupDir = join(root, group);
    let entries: string[];
    try {
      entries = readdirSync(groupDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const manifest = join(groupDir, entry, 'package.json');
      if (existsSync(manifest)) {
        manifests.push(manifest);
      }
    }
  }

  return manifests;
}

export function checkBannedDependencies(root: string): IViolation[] {
  const violations: IViolation[] = [];

  for (const manifest of findManifests(root)) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>;
    } catch {
      continue;
    }

    for (const field of DEPENDENCY_FIELDS) {
      const block = parsed[field];
      if (typeof block !== 'object' || block === null) {
        continue;
      }

      for (const name of Object.keys(block)) {
        const reason = BANNED[name];
        if (reason !== undefined) {
          violations.push({
            file: manifest,
            rule: 'banned-dependencies',
            message: `\`${name}\` is banned from this repo but appears in ${field}. ${reason}`,
          });
        }
      }
    }
  }

  return violations;
}

/** Workspace manifests must not declare a banned dependency. */
export const bannedDependenciesRule: IMetaRule = {
  id: 'banned-dependencies',
  category: 'supply-chain',
  description: 'Workspace manifests must not declare a banned dependency.',
  ciCritical: true,
  run({ root }: IMetaContext): IViolation[] {
    return checkBannedDependencies(root);
  },
};
