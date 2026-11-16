/*
 * The slice of semver the override ledger needs, with no dependency.
 *
 * `semver` is not hoisted into the root node_modules (pnpm's store is strict),
 * and adding it to the root manifest to compare four kinds of comparator would
 * put a new dependency in the lockfile purely so a lint rule could read the
 * lockfile. The grammar the pnpm override block actually uses is small and
 * closed: selectors are `<x`, `<=x`, `>=a <b`, `>=a <=b` or `=x`, and targets
 * are `^x`, `~x` or a bare version. Anything outside that returns `null`, and
 * the rule reports the unparseable string rather than quietly passing it.
 */

export interface IVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** Dot-separated prerelease identifiers, empty for a release. */
  readonly prerelease: readonly string[];
}

export type ComparatorOp = '<' | '<=' | '>' | '>=' | '=';

export interface IComparator {
  readonly op: ComparatorOp;
  readonly version: IVersion;
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u;
const COMPARATOR_PATTERN = /^(<=|>=|<|>|=)?\s*(.+)$/u;

/** A version, or `null` when the text is not a plain `x.y.z` release or prerelease. */
export function parseVersion(text: string): IVersion | null {
  const match = VERSION_PATTERN.exec(text.trim());
  if (match === null) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  };
}

function comparePrerelease(a: readonly string[], b: readonly string[]): number {
  // A release outranks any prerelease of the same triple (semver 11).
  if (a.length === 0 || b.length === 0) {
    return a.length === b.length ? 0 : a.length === 0 ? 1 : -1;
  }

  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === undefined || right === undefined) {
      return left === undefined ? -1 : 1;
    }
    if (left === right) {
      continue;
    }

    const leftNumeric = /^\d+$/u.test(left);
    const rightNumeric = /^\d+$/u.test(right);
    if (leftNumeric && rightNumeric) {
      return Number(left) - Number(right);
    }
    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    }
    return left < right ? -1 : 1;
  }

  return 0;
}

/** Negative when `a` sorts before `b`, positive when after, zero when equal. */
export function compareVersions(a: IVersion, b: IVersion): number {
  return (
    a.major - b.major ||
    a.minor - b.minor ||
    a.patch - b.patch ||
    comparePrerelease(a.prerelease, b.prerelease)
  );
}

/**
 * A whitespace-separated conjunction of comparators (`>=10.1.1 <=10.2.1`), or
 * `null` when any clause is not one of the supported operators over a plain
 * version. A bare version means `=`.
 */
export function parseRange(text: string): IComparator[] | null {
  const clauses = text.trim().split(/\s+/u).filter(Boolean);
  if (clauses.length === 0) {
    return null;
  }

  const comparators: IComparator[] = [];

  for (const clause of clauses) {
    const match = COMPARATOR_PATTERN.exec(clause);
    const versionText = match?.[2];
    if (versionText === undefined) {
      return null;
    }

    const version = parseVersion(versionText);
    if (version === null) {
      return null;
    }

    comparators.push({ op: (match?.[1] as ComparatorOp | undefined) ?? '=', version });
  }

  return comparators;
}

function satisfiesComparator(version: IVersion, comparator: IComparator): boolean {
  const ordering = compareVersions(version, comparator.version);

  switch (comparator.op) {
    case '<':
      return ordering < 0;
    case '<=':
      return ordering <= 0;
    case '>':
      return ordering > 0;
    case '>=':
      return ordering >= 0;
    case '=':
      return ordering === 0;
  }
}

/** Whether a version satisfies every comparator of a parsed range. */
export function satisfies(version: IVersion, range: readonly IComparator[]): boolean {
  return range.every((comparator) => satisfiesComparator(version, comparator));
}

/**
 * The lowest version an override TARGET can install: the version inside `^x`,
 * `~x`, `>=x` or a bare `x`. This is what the pin-into-range check compares
 * against `firstPatched`, because a caret target can only ever resolve upward.
 */
export function targetLowerBound(target: string): IVersion | null {
  return parseVersion(target.trim().replace(/^(?:\^|~|>=|=)/u, ''));
}

/**
 * An override key split into the package it rewrites and its optional version
 * selector. `react` has no selector; `@xmldom/xmldom@<0.8.15` has one, and the
 * leading `@` of a scoped name is not the separator.
 */
export function splitOverrideKey(key: string): { name: string; selector: string | null } {
  const separator = key.indexOf('@', key.startsWith('@') ? 1 : 0);
  if (separator === -1) {
    return { name: key, selector: null };
  }

  return { name: key.slice(0, separator), selector: key.slice(separator + 1) };
}
