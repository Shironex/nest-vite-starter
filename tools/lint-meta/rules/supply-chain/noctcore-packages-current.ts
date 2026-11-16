import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { IMetaContext, IMetaRule, IViolation } from '../../types';

const RULE_ID = 'noctcore-packages-current';

/** Manifests that may declare a `@noctcore/*` dependency. */
const MANIFESTS = [
  'package.json',
  'packages/eslint-config/package.json',
  'apps/api/package.json',
  'apps/web/package.json',
] as const;

/** One `@noctcore/*` range as a manifest declares it. */
export interface IDeclaredNoctcoreRange {
  readonly name: string;
  readonly range: string;
  /** Manifest path, relative to the repo root. */
  readonly file: string;
  readonly block: 'dependencies' | 'devDependencies';
}

/** Every `@noctcore/*` range declared by the manifests in MANIFESTS. */
export function declaredNoctcoreRanges(root: string): IDeclaredNoctcoreRange[] {
  const found: IDeclaredNoctcoreRange[] = [];

  for (const rel of MANIFESTS) {
    const abs = join(root, rel);
    if (!existsSync(abs)) continue;

    const pkg = JSON.parse(readFileSync(abs, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    for (const block of ['dependencies', 'devDependencies'] as const) {
      for (const [name, range] of Object.entries(pkg[block] ?? {})) {
        if (name.startsWith('@noctcore/')) {
          found.push({ name, range, file: rel, block });
        }
      }
    }
  }

  return found;
}

/**
 * The version installed for `name` as `file` resolves it, or null when it is
 * not installed. pnpm isolates by default, so a workspace package's dependency
 * lands in ITS node_modules, not the root's. Resolve from the manifest that
 * declares it and fall back to the root, which is where a root devDep is.
 */
export function installedNoctcoreVersion(root: string, file: string, name: string): string | null {
  const manifestDir = join(root, file).replace(/[/\\]package\.json$/u, '');
  const candidates = [
    join(manifestDir, 'node_modules', name, 'package.json'),
    join(root, 'node_modules', name, 'package.json'),
  ];
  const manifest = candidates.find((candidate) => existsSync(candidate));
  if (manifest === undefined) return null;
  return (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version;
}

/** The minor a `^0.x.y` range is pinned to, or null when it is not that shape. */
function caretZeroMinor(range: string): string | null {
  const match = /^\^0\.(\d+)\./u.exec(range);
  return match?.[1] ?? null;
}

/**
 * Every installed `@noctcore/*` package must be the version its range allows.
 *
 * This exists because the mistake is easy to make and invisible every time. A caret range on a 0.x version does not cross the minor:
 * `^0.2.0` never resolves to `0.3.0`. So a package gets published, the consumer
 * keeps resolving the old minor, and nothing anywhere says so. Lint stays green,
 * because the rules it wires still exist; the new ones simply are not there.
 *
 * A `^0.2.0` range on a rules package, for example, silently hides every rule
 * that ships in 0.3.0 and later.
 *
 * The check is deliberately OFFLINE. It compares the range a manifest declares
 * against the version actually on disk, not against the registry: a network
 * call would make lint:meta fail on a plane, and the failure this rule is for
 * shows up entirely locally. A range that cannot reach its own installed
 * version, or a stale lockfile, is what it catches.
 *
 * What it cannot catch is a package whose latest is newer than anything the
 * range admits, because that needs the registry: declared and installed agree
 * perfectly while both sit a minor behind. `pnpm check:noctcore-published`
 * (tools/quality/check-noctcore-published.ts) is that half. It runs in
 * `pnpm verify --profile=release`, the profile a change is finished against, and
 * never in lint:meta.
 */
export const noctcorePackagesCurrentRule: IMetaRule = {
  id: RULE_ID,
  category: 'supply-chain',
  ciCritical: true,
  description:
    'An installed @noctcore package must match the range that declares it, so a caret on 0.x cannot silently pin this repo behind a published minor.',
  run({ root }: IMetaContext): IViolation[] {
    const violations: IViolation[] = [];

    for (const { name, range, file } of declaredNoctcoreRanges(root)) {
      const installed = installedNoctcoreVersion(root, file, name);

      if (installed === null) {
        violations.push({
          file,
          rule: RULE_ID,
          message: `"${name}" is declared at "${range}" but is not installed for "${file}", so what lint actually loads cannot be checked. Run \`pnpm install\`.`,
        });
        continue;
      }

      const pinnedMinor = caretZeroMinor(range);
      if (pinnedMinor === null) continue;

      const installedMinor = /^0\.(\d+)\./u.exec(installed)?.[1];
      if (installedMinor !== undefined && installedMinor !== pinnedMinor) {
        violations.push({
          file,
          rule: RULE_ID,
          message: `"${name}" is declared "${range}" but ${installed} is installed. A caret range on a 0.x version cannot cross the minor, so these disagree and one of them is not what you meant. Either widen the range to "^0.${installedMinor}.0" or reinstall.`,
        });
      }
    }

    return violations;
  },
};
