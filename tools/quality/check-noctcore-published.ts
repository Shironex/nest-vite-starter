/**
 * `pnpm check:noctcore-published`: is every declared `@noctcore/*` package
 * able to reach, and actually on, the version the registry calls latest?
 *
 * This is the registry half of lint:meta's `noctcore-packages-current`, which
 * compares declared against installed and stays offline on purpose. Declared
 * and installed can agree perfectly while both sit a minor behind what is
 * published, and only the registry can say so.
 *
 * It runs in `pnpm verify --profile=release`, not in lint:meta and not on
 * every push: the release profile is what a change is finished against, which is
 * the moment a newly published noctcore minor has to be picked up, and keeping
 * it out of the per-push path keeps lint and CI independent of the registry.
 *
 * The registry's latest is only a fair target because `@noctcore/*` is exempt
 * from the global min-release-age gate (`minimumReleaseAgeExclude` in
 * pnpm-workspace.yaml); without that a fresh release would read as behind
 * while no install could reach it.
 *
 * Exit codes: 0 every package is current, 1 at least one finding, 2 the
 * registry could not be asked (offline, timeout, unexpected answer), which
 * `verify` reports as BLOCKED rather than as a pass or a failure.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  declaredNoctcoreRanges,
  installedNoctcoreVersion,
} from '../lint-meta/rules/supply-chain/noctcore-packages-current';
import { classify, type IFinding, type IPackageState } from './noctcore-published';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REGISTRY = 'https://registry.npmjs.org';
const TIMEOUT_MS = 15_000;
const EXIT_BLOCKED = 2;

class RegistryUnavailableError extends Error {}

async function publishedLatest(name: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${REGISTRY}/${name}/latest`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new RegistryUnavailableError(`${name}: the registry did not answer`, { cause: error });
  }
  if (!response.ok) {
    throw new RegistryUnavailableError(
      `${name}: the registry answered HTTP ${String(response.status)}`,
    );
  }
  const body = (await response.json()) as { version?: unknown };
  if (typeof body.version !== 'string') {
    throw new RegistryUnavailableError(`${name}: the registry answer has no version`);
  }
  return body.version;
}

function print(findings: readonly IFinding[]): void {
  const unreachable = findings.filter((finding) => finding.kind === 'unreachable');
  const rest = findings.filter((finding) => finding.kind !== 'unreachable');

  if (unreachable.length > 0) {
    console.error(
      `${String(unreachable.length)} range(s) CANNOT REACH the published version. No install will fix these; a range has to be widened by hand:\n`,
    );
    for (const finding of unreachable) console.error(`  ${finding.message}`);
    console.error('');
  }
  if (rest.length > 0) {
    console.error(`${String(rest.length)} other finding(s):\n`);
    for (const finding of rest) console.error(`  [${finding.kind}] ${finding.message}`);
    console.error('');
  }
}

async function main(): Promise<number> {
  const declared = declaredNoctcoreRanges(REPO_ROOT);
  const names = [...new Set(declared.map((entry) => entry.name))];

  let latest: Map<string, string>;
  try {
    const versions = await Promise.all(names.map((name) => publishedLatest(name)));
    latest = new Map(names.map((name, index) => [name, versions[index] ?? '']));
  } catch (error) {
    if (!(error instanceof RegistryUnavailableError)) throw error;
    console.error(
      `noctcore published check BLOCKED: ${error.message}. This is not a pass; rerun it online.`,
    );
    return EXIT_BLOCKED;
  }

  const states: IPackageState[] = declared.map((entry) => ({
    ...entry,
    installed: installedNoctcoreVersion(REPO_ROOT, entry.file, entry.name),
    published: latest.get(entry.name) ?? '',
  }));
  const findings = states.map(classify).filter((finding) => finding !== null);

  if (findings.length === 0) {
    console.log(
      `noctcore published check OK: ${String(states.length)} declared range(s) across ${String(new Set(states.map((state) => state.file)).size)} manifest(s), every one installed at the published latest.`,
    );
    return 0;
  }

  print(findings);
  return 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = EXIT_BLOCKED;
  },
);
