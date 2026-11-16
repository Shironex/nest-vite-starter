/**
 * Compares each declared `@noctcore/*` range, and the version installed for
 * it, against the latest version on the registry. Pure: the CLI in
 * check-noctcore-published.ts does the fetching and the printing.
 *
 * Two findings, kept apart because they need different people:
 *
 * - `unreachable`: the range cannot resolve to the published latest. A caret
 *   on 0.x never crosses the minor, so `^0.5.0` stays on 0.5.x forever while
 *   0.6.0 sits on the registry. Only a human widening the range fixes it, and
 *   nothing else in the toolchain reports it.
 * - `stale-lockfile`: the range admits the latest, but the lockfile still pins
 *   an older version. `pnpm update` fixes it without widening any range, with
 *   one exception worth knowing: `minimumReleaseAge` is 7 days here, and inside
 *   that window the resolver refuses to move to a fresh release and reports
 *   nothing while refusing. The update exits 0, the lockfile does not change,
 *   and this check keeps reporting the same package. An explicit
 *   `pnpm add <name>@^<version>` is what moves it, which is why the message
 *   says so rather than leaving the reader to discover it.
 */

export interface IVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

export interface IPackageState {
  readonly name: string;
  readonly range: string;
  /** Manifest path, relative to the repo root. */
  readonly file: string;
  readonly block: 'dependencies' | 'devDependencies';
  /** Null when nothing is installed for this manifest. */
  readonly installed: string | null;
  readonly published: string;
}

export type FindingKind =
  'unreachable' | 'stale-lockfile' | 'ahead-of-registry' | 'unrecognised-range';

export interface IFinding {
  readonly kind: FindingKind;
  readonly state: IPackageState;
  readonly message: string;
}

export function parseVersion(text: string): IVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(text.trim());
  if (match === null) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function compareVersions(a: IVersion, b: IVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * Whether `range` admits `version`, for the three range shapes the manifests
 * use: `^x.y.z`, `~x.y.z` and an exact `x.y.z`. Null for any other shape, so a
 * range this cannot read is reported rather than guessed at.
 */
export function rangeAdmits(range: string, version: IVersion): boolean | null {
  const operator = /^[\^~]/u.exec(range)?.[0] ?? '';
  const floor = parseVersion(range.slice(operator.length));
  if (floor === null) return null;
  if (compareVersions(version, floor) < 0) return false;

  if (operator === '') return compareVersions(version, floor) === 0;
  if (operator === '~') return version.major === floor.major && version.minor === floor.minor;

  // Caret: the first non-zero component is fixed, so on 0.x the minor is.
  if (floor.major > 0) return version.major === floor.major;
  if (floor.minor > 0) return version.major === 0 && version.minor === floor.minor;
  return version.major === 0 && version.minor === 0 && version.patch === floor.patch;
}

function addCommand(state: IPackageState): string {
  const range = `${state.name}@^${state.published}`;
  const dev = state.block === 'devDependencies' ? ' -D' : '';
  if (state.file === 'package.json') return `pnpm add -w${dev} ${range}`;
  const dir = state.file.replace(/\/package\.json$/u, '');
  return `pnpm --dir ${dir} add${dev} ${range}`;
}

export function classify(state: IPackageState): IFinding | null {
  const published = parseVersion(state.published);
  const admits = published === null ? null : rangeAdmits(state.range, published);

  if (published === null || admits === null) {
    return {
      kind: 'unrecognised-range',
      state,
      message: `${state.name} in ${state.file}: cannot compare "${state.range}" with published ${state.published}. This check reads ^x.y.z, ~x.y.z and exact x.y.z ranges; read this one by hand.`,
    };
  }

  const floor = parseVersion(state.range.replace(/^[\^~]/u, ''));
  if (floor !== null && compareVersions(floor, published) > 0) {
    return {
      kind: 'ahead-of-registry',
      state,
      message: `${state.name} in ${state.file}: "${state.range}" asks for more than the registry has (latest ${state.published}). Either the version was never published or the range was mistyped.`,
    };
  }

  if (!admits) {
    return {
      kind: 'unreachable',
      state,
      message: `${state.name} in ${state.file}: RANGE CANNOT REACH THE PUBLISHED VERSION. "${state.range}" never resolves to ${state.published}${state.range.startsWith('^0.') ? ' (a caret on 0.x does not cross the minor)' : ''}, so no install will pick it up. Widen it: \`${addCommand(state)}\`, then fix whatever the new version flags.`,
    };
  }

  const installed = state.installed === null ? null : parseVersion(state.installed);
  if (installed === null || compareVersions(installed, published) < 0) {
    return {
      kind: 'stale-lockfile',
      state,
      message: `${state.name} in ${state.file}: LOCKFILE IS STALE. "${state.range}" already admits ${state.published} but ${state.installed ?? 'nothing'} is installed. No range needs widening: \`pnpm update -r ${state.name}\` (it also raises the range floor to the version it installs). If that exits 0 and changes nothing, the release is younger than \`minimumReleaseAge\` and the resolver is refusing to move silently; \`pnpm add ${state.name}@^${state.published}\` in the manifest's own directory works inside that window.`,
    };
  }

  return null;
}
