import type { LaneId } from './lanes';

/*
 * The suites the inventory covers, and the one fact each runner does not agree
 * on: where its JUnit paths are rooted.
 *
 * Every runner here emits JUnit natively (jest through jest-junit, which the
 * security lane already depends on; vitest and Playwright through their built-in
 * reporters), so the inventory reads one shape and does not care which produced
 * it. The reporter is wired in each runner's own config rather than appended to
 * a command, because `verify` reaches the unit suites through `turbo test`,
 * which fans out to eight runners at once and cannot carry eight different
 * --outputFile flags.
 *
 * Not listed: the security lane. `apps/api/security-spec` is already reconciled
 * case by case against findings.json by `pnpm check:security`, which is a
 * stricter version of this check, so inventorying it twice would only mean two
 * baselines to keep in step.
 */
export interface IInventorySuite {
  readonly id: string;
  /** What the suite is, for the CLI's own output. */
  readonly label: string;
  /** Repo-relative directory the runner's reported paths hang off. */
  readonly pathBase: string;
  /** Repo-relative JUnit report the runner writes on every run. */
  readonly report: string;
  /** argv that runs just this suite, from the repo root. */
  readonly command: readonly string[];
  /** Sandbox lane whose DATABASE_URL the suite needs, when it needs one. */
  readonly lane?: LaneId;
  /**
   * Whether `--from-report` refuses to finish when this suite left no report.
   * False only for e2e: `verify feature` never runs it, so demanding its report
   * would block the profile that is not supposed to boot a browser. The e2e
   * check itself is what reports a missing e2e run.
   */
  readonly required: boolean;
  /**
   * Run only when named with `--suite`. Set on the e2e lane, which boots an
   * api, a web build and a browser: a bare `pnpm verify:inventory` must not
   * cost ten minutes, but it still compares the e2e report when one is there.
   */
  readonly onDemand?: true;
}

/** Where every runner in this repo is told to write its JUnit report. */
export const INVENTORY_REPORT_DIR = '.agent-state/inventory';

export const INVENTORY_SUITES: readonly IInventorySuite[] = [
  {
    id: 'api',
    label: 'apps/api unit lane (jest)',
    pathBase: 'apps/api',
    report: `${INVENTORY_REPORT_DIR}/api.junit.xml`,
    command: ['pnpm', '--filter', '@repo/api', 'test'],
    required: true,
  },
  {
    id: 'isolation',
    label: 'apps/api isolation lane (jest, live Postgres)',
    pathBase: 'apps/api',
    report: `${INVENTORY_REPORT_DIR}/isolation.junit.xml`,
    command: ['pnpm', '--filter', '@repo/api', 'test:integration'],
    lane: 'isolation',
    required: true,
  },
  {
    id: 'web',
    label: 'apps/web (vitest)',
    pathBase: 'apps/web',
    report: `${INVENTORY_REPORT_DIR}/web.junit.xml`,
    command: ['pnpm', '--filter', '@repo/web', 'test'],
    required: true,
  },
  {
    id: 'shared',
    label: 'packages/shared (vitest)',
    pathBase: 'packages/shared',
    report: `${INVENTORY_REPORT_DIR}/shared.junit.xml`,
    command: ['pnpm', '--filter', '@repo/shared', 'test'],
    required: true,
  },
  {
    id: 'ui',
    label: 'packages/ui (vitest)',
    pathBase: 'packages/ui',
    report: `${INVENTORY_REPORT_DIR}/ui.junit.xml`,
    command: ['pnpm', '--filter', '@repo/ui', 'test'],
    required: true,
  },
  {
    id: 'email',
    label: 'packages/email (vitest)',
    pathBase: 'packages/email',
    report: `${INVENTORY_REPORT_DIR}/email.junit.xml`,
    command: ['pnpm', '--filter', '@repo/email', 'test'],
    required: true,
  },
  {
    id: 'eslint-config',
    label: 'packages/eslint-config (vitest)',
    pathBase: 'packages/eslint-config',
    report: `${INVENTORY_REPORT_DIR}/eslint-config.junit.xml`,
    command: ['pnpm', '--filter', '@repo/eslint-config', 'test'],
    required: true,
  },
  {
    id: 'eslint-plugin-repo',
    label: 'packages/eslint-plugin-repo (vitest)',
    pathBase: 'packages/eslint-plugin-repo',
    report: `${INVENTORY_REPORT_DIR}/eslint-plugin-repo.junit.xml`,
    command: ['pnpm', '--filter', '@repo/eslint-plugin-repo', 'test'],
    required: true,
  },
  {
    // Playwright's classname is relative to `testDir`, which is apps/web/e2e,
    // and the lane already writes this report for the `e2e` verify check, so
    // nothing new is emitted here.
    id: 'e2e',
    label: 'apps/web e2e (Playwright, through pnpm e2e:lane)',
    pathBase: 'apps/web/e2e',
    report: 'apps/web/playwright-report/e2e-lane.junit.xml',
    command: ['pnpm', 'e2e:lane'],
    lane: 'e2e',
    required: false,
    onDemand: true,
  },
];

export function suiteById(id: string): IInventorySuite {
  const suite = INVENTORY_SUITES.find((candidate) => candidate.id === id);
  if (suite === undefined) {
    throw new Error(
      `Unknown suite "${id}". Known suites: ${INVENTORY_SUITES.map((s) => s.id).join(', ')}.`,
    );
  }
  return suite;
}
