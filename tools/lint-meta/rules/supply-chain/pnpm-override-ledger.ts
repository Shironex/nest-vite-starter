import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { IMetaContext, IMetaRule, IViolation } from '../../types';
import {
  compareVersions,
  parseRange,
  parseVersion,
  satisfies,
  splitOverrideKey,
  targetLowerBound,
} from './version-range';

const RULE_ID = 'pnpm-override-ledger';
const LEDGER_FILE = 'overrides.ledger.json';
const MANIFEST_FILE = 'package.json';
const LOCKFILE = 'pnpm-lock.yaml';

/*
 * Every pnpm override must say why it exists and when to look at it again.
 *
 * A `pnpm.overrides` entry is a security control written as a bare version
 * string. It carries no advisory, no first patched version and no expiry, and
 * from the outside a stale one is indistinguishable from a live one: it exists,
 * it applies, and it does nothing useful. Three ways it goes wrong:
 *
 *   - `"tar@<7.5.22": "7.5.20"` pinned INTO the vulnerable range.
 *     The advisory was `<=7.5.20`, so the override fired on every install and
 *     landed on a version that was still vulnerable.
 *   - new advisories (brace-expansion, for one) widened past pins that had
 *     been correct when they were written.
 *   - an override sits one patch behind the fix and is actively holding the tree on vulnerable versions.
 *
 * `overrides.ledger.json` is keyed by the exact override key and carries the
 * missing facts. This rule is what makes the ledger load-bearing rather than
 * decorative. It reports:
 *
 *   1. an override with no ledger entry, and a ledger entry with no override
 *   2. a `reviewBy` that is missing, unparseable, or in the past (an undated
 *      exception is not an exception)
 *   3. a `security` entry whose target can only resolve BELOW its own
 *      `firstPatched`, which is the tar case above and the one check that
 *      would have caught it
 *   4. a lockfile that still resolves a version inside the selector, which is
 *      an override that was never applied
 *   5. a selector-less pin that resolves to more than one version, which is a
 *      `unify` override that is not unifying
 *
 * `reviewBy` carries more weight than it looks like it should. GitHub pauses
 * Dependabot's automated security fixes by itself once its pull requests are
 * repeatedly closed without merging, and then the feed that was supposed to
 * notice a stale override stops opening pull requests; the date in this ledger
 * still says "look at this again".
 *
 * Dormant by design: with no override block and no ledger the rule returns [].
 * The lockfile reads are textual (`pnpm why` can mislead about what
 * resolves, so the lockfile is read directly) and a version the reader cannot parse is
 * skipped rather than guessed at.
 */

type LedgerKind = 'security' | 'unify';

interface ILedgerEntry {
  readonly kind: LedgerKind;
  readonly advisories?: readonly string[];
  readonly firstPatched?: string;
  readonly reason: string;
  readonly reviewBy: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

function isLedgerKind(value: unknown): value is LedgerKind {
  return value === 'security' || value === 'unify';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function violation(file: string, message: string): IViolation {
  return { file, rule: RULE_ID, message };
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The root manifest's `pnpm.overrides`, or null when there is no block at all. */
export function readOverrides(root: string): Record<string, string> | null {
  const pnpmBlock = asRecord(asRecord(readJson(join(root, MANIFEST_FILE)))?.['pnpm']);
  const overrides = asRecord(pnpmBlock?.['overrides']);
  if (overrides === null) {
    return null;
  }

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === 'string') {
      out[key] = value;
    }
  }
  return out;
}

/**
 * The versions `pnpm-lock.yaml` resolves per package name, read out of the
 * `packages:` section. Keys there are `name@version:`, quoted when the name is
 * scoped; the `snapshots:` section repeats them with peer suffixes and is
 * deliberately skipped.
 */
export function readLockfileResolutions(root: string): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  const lockfile = join(root, LOCKFILE);
  if (!existsSync(lockfile)) {
    return byName;
  }

  let inPackages = false;

  for (const line of readFileSync(lockfile, 'utf8').split('\n')) {
    if (/^\S/u.test(line)) {
      inPackages = line.startsWith('packages:');
      continue;
    }
    if (!inPackages) {
      continue;
    }

    const match = /^ {2}(?:'([^']+)'|([^\s:][^:]*)):$/u.exec(line);
    const key = match?.[1] ?? match?.[2];
    if (key === undefined) {
      continue;
    }

    const { name, selector: version } = splitOverrideKey(key);
    if (version === null) {
      continue;
    }

    const versions = byName.get(name) ?? [];
    versions.push(version);
    byName.set(name, versions);
  }

  return byName;
}

/** The lockfile's own `overrides:` block, as raw `key: value` text pairs. */
export function readLockfileOverrides(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const lockfile = join(root, LOCKFILE);
  if (!existsSync(lockfile)) {
    return out;
  }

  let inOverrides = false;

  for (const line of readFileSync(lockfile, 'utf8').split('\n')) {
    if (/^\S/u.test(line)) {
      inOverrides = line.startsWith('overrides:');
      continue;
    }
    if (!inOverrides) {
      continue;
    }

    const match = /^ {2}(?:'([^']+)'|([^\s:][^:]*)):\s*(.+)$/u.exec(line);
    const key = match?.[1] ?? match?.[2];
    const value = match?.[3];
    if (key !== undefined && value !== undefined) {
      out.set(key, value.trim().replace(/^'(.*)'$/u, '$1'));
    }
  }

  return out;
}

/** A parsed ledger entry, or the reason it is not one. */
function parseEntry(raw: unknown): { entry: ILedgerEntry } | { error: string } {
  const record = asRecord(raw);
  if (record === null) {
    return { error: 'the entry is not an object' };
  }

  const kind = record['kind'];
  if (!isLedgerKind(kind)) {
    return { error: '`kind` must be "security" or "unify"' };
  }

  const reason = record['reason'];
  if (typeof reason !== 'string' || reason.trim() === '') {
    return { error: '`reason` must be a non-empty string' };
  }

  const reviewBy = record['reviewBy'];
  if (typeof reviewBy !== 'string') {
    return { error: '`reviewBy` is missing. An undated entry is not an exception' };
  }

  const advisories = record['advisories'];
  if (advisories !== undefined && !isStringArray(advisories)) {
    return { error: '`advisories` must be an array of advisory ids' };
  }

  const firstPatched = record['firstPatched'];
  if (firstPatched !== undefined && typeof firstPatched !== 'string') {
    return { error: '`firstPatched` must be a version string' };
  }

  // Spread rather than assign: `exactOptionalPropertyTypes` makes an explicit
  // `advisories: undefined` a different thing from an absent key.
  return {
    entry: {
      kind,
      reason,
      reviewBy,
      ...(advisories === undefined ? {} : { advisories }),
      ...(firstPatched === undefined ? {} : { firstPatched }),
    },
  };
}

function checkReviewBy(key: string, reviewBy: string, today: Date): IViolation[] {
  if (!ISO_DATE.test(reviewBy)) {
    return [
      violation(
        LEDGER_FILE,
        `\`${key}\` has \`reviewBy: "${reviewBy}"\`, which is not a yyyy-MM-dd date. An undated entry is not an exception.`,
      ),
    ];
  }

  const due = new Date(`${reviewBy}T00:00:00Z`);
  if (Number.isNaN(due.getTime())) {
    return [
      violation(
        LEDGER_FILE,
        `\`${key}\` has \`reviewBy: "${reviewBy}"\`, which is not a real date.`,
      ),
    ];
  }

  if (due.getTime() >= today.getTime()) {
    return [];
  }

  return [
    violation(
      LEDGER_FILE,
      `\`${key}\` was due for review on ${reviewBy}. Re-check it against open advisories, then delete the override or move the date forward with a reason.`,
    ),
  ];
}

function checkSecurityEntry(key: string, entry: ILedgerEntry, target: string): IViolation[] {
  if (entry.firstPatched === undefined) {
    return [
      violation(
        LEDGER_FILE,
        `\`${key}\` is a security override with no \`firstPatched\`. Record the advisory's first patched version so the pin can be checked against it.`,
      ),
    ];
  }

  const firstPatched = parseVersion(entry.firstPatched);
  if (firstPatched === null) {
    return [
      violation(
        LEDGER_FILE,
        `\`${key}\` has \`firstPatched: "${entry.firstPatched}"\`, which is not a plain x.y.z version.`,
      ),
    ];
  }

  const lowest = targetLowerBound(target);
  if (lowest === null) {
    return [
      violation(
        LEDGER_FILE,
        `\`${key}\` overrides to "${target}", which this rule cannot read as ^x.y.z, ~x.y.z or x.y.z. Write a plain target so the pin can be compared against \`firstPatched\`.`,
      ),
    ];
  }

  if (compareVersions(lowest, firstPatched) >= 0) {
    return [];
  }

  return [
    violation(
      LEDGER_FILE,
      `\`${key}\` overrides to "${target}", whose lowest resolvable version is below its own \`firstPatched\` (${entry.firstPatched}). The override fires on every install and still lands on a vulnerable version. This is the 2026-07-31 \`tar\` failure.`,
    ),
  ];
}

function checkLockfileResolution(
  key: string,
  target: string,
  resolutions: Map<string, string[]>,
): IViolation[] {
  const { name, selector } = splitOverrideKey(key);
  const resolved = resolutions.get(name) ?? [];

  if (selector === null) {
    // A selector-less pin exists to collapse the tree onto one copy. More than
    // one resolved version means it is not doing that, which is the failure a
    // `unify` pin exists to prevent and the one no advisory feed reports.
    if (resolved.length <= 1) {
      return [];
    }
    return [
      violation(
        LOCKFILE,
        `\`${key}\` pins one version ("${target}") but pnpm-lock.yaml resolves ${String(resolved.length)}: ${resolved.join(', ')}. The pin is not unifying the tree.`,
      ),
    ];
  }

  const range = parseRange(selector);
  if (range === null) {
    return [
      violation(
        MANIFEST_FILE,
        `\`${key}\` has a selector this rule cannot read ("${selector}"). Use \`<x\`, \`<=x\`, \`>=a <b\` or \`=x\` so the lockfile can be checked against it.`,
      ),
    ];
  }

  const stillVulnerable = resolved.filter((version) => {
    const parsed = parseVersion(version);
    return parsed !== null && satisfies(parsed, range);
  });

  if (stillVulnerable.length === 0) {
    return [];
  }

  return [
    violation(
      LOCKFILE,
      `\`${key}\` should have moved every copy past "${selector}", but pnpm-lock.yaml still resolves ${name}@${stillVulnerable.join(', ')}. The override is declared and not honored.`,
    ),
  ];
}

export function checkPnpmOverrideLedger(root: string, today: Date = new Date()): IViolation[] {
  const overrides = readOverrides(root);
  const ledgerPath = join(root, LEDGER_FILE);
  const ledgerExists = existsSync(ledgerPath);

  if (overrides === null && !ledgerExists) {
    return [];
  }

  if (!ledgerExists) {
    return [
      violation(
        LEDGER_FILE,
        `The root package.json declares pnpm.overrides but ${LEDGER_FILE} does not exist. Every override needs a reason, an advisory and a review date.`,
      ),
    ];
  }

  const ledger = asRecord(readJson(ledgerPath));
  if (ledger === null) {
    return [violation(LEDGER_FILE, `${LEDGER_FILE} is not a JSON object keyed by override key.`)];
  }

  const violations: IViolation[] = [];
  const declared = overrides ?? {};
  const resolutions = readLockfileResolutions(root);
  const lockfileOverrides = readLockfileOverrides(root);

  for (const key of Object.keys(ledger)) {
    if (!(key in declared)) {
      violations.push(
        violation(
          LEDGER_FILE,
          `\`${key}\` has a ledger entry but no matching pnpm.overrides key. Delete the entry, or restore the override if it was dropped by accident.`,
        ),
      );
    }
  }

  for (const [key, target] of Object.entries(declared)) {
    const raw = ledger[key];
    if (raw === undefined) {
      violations.push(
        violation(
          LEDGER_FILE,
          `\`${key}\` is overridden to "${target}" with no ledger entry. Add one with \`kind\`, \`reason\` and \`reviewBy\` (plus \`advisories\` and \`firstPatched\` when it is a security pin).`,
        ),
      );
      continue;
    }

    const parsed = parseEntry(raw);
    if ('error' in parsed) {
      violations.push(violation(LEDGER_FILE, `\`${key}\`: ${parsed.error}.`));
      continue;
    }

    violations.push(...checkReviewBy(key, parsed.entry.reviewBy, today));

    if (parsed.entry.kind === 'security') {
      violations.push(...checkSecurityEntry(key, parsed.entry, target));
    }

    violations.push(...checkLockfileResolution(key, target, resolutions));

    const locked = lockfileOverrides.get(key);
    if (lockfileOverrides.size > 0 && locked !== target) {
      violations.push(
        violation(
          LOCKFILE,
          `\`${key}\` is overridden to "${target}" in package.json but ${
            locked === undefined ? 'is absent from' : `reads "${locked}" in`
          } the lockfile's overrides block. Run \`pnpm install\` so the lockfile records the override that is actually declared.`,
        ),
      );
    }
  }

  return violations;
}

/** Every pnpm override must carry a dated, advisory-backed ledger entry that the lockfile honors. */
export const pnpmOverrideLedgerRule: IMetaRule = {
  id: RULE_ID,
  category: 'supply-chain',
  ciCritical: true,
  description:
    'Every pnpm.overrides entry needs an overrides.ledger.json entry with a reason and an unexpired reviewBy, a security pin must target its own firstPatched or higher, and the lockfile must honor the override.',
  run({ root }: IMetaContext): IViolation[] {
    return checkPnpmOverrideLedger(root);
  },
};
