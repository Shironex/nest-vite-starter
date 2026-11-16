import type { LaneId } from './lanes';
import type { Profile } from './result';

/*
 * The checks `pnpm verify` runs, in the order it runs them. Three profiles,
 * each a superset of the one before: `static` is what a change to source can be
 * judged by without a service, `feature` adds the suites and the database
 * gates, `release` adds the byte budget and the e2e lane and is the profile a
 * change is finished against.
 *
 * `manifestCommand` ties a check to the exact string in
 * scripts/ci/pre-push.manifest.json. checks.test.ts asserts the two agree in
 * both directions, so a gate added to pre-push (and therefore to ci.yml, which
 * pre-push-ci-parity enforces) cannot be missing from `verify release`.
 */
const STATIC: readonly Profile[] = ['static', 'feature', 'release'];
const FEATURE: readonly Profile[] = ['feature', 'release'];
const RELEASE: readonly Profile[] = ['release'];

export interface IReportSpec {
  readonly kind: 'jest-json' | 'junit';
  /** Path relative to the repo root that the runner is told to write. */
  readonly file: string;
  /**
   * Arguments appended to the command so it emits that report. `{{reportPath}}`
   * is replaced with the ABSOLUTE path of `file`: a lane command runs through
   * `pnpm --filter`, whose cwd is the package, so a relative --outputFile lands
   * inside apps/api and the report reads as missing while the suite passed.
   */
  readonly args: readonly string[];
}

export interface ICheckSpec {
  readonly id: string;
  readonly profiles: readonly Profile[];
  /** argv, run from the repo root. Empty for the checks the CLI runs itself. */
  readonly command: readonly string[];
  readonly manifestCommand?: string;
  /** Sandbox lane whose DATABASE_URL and REDIS_URL the command needs. */
  readonly lane?: LaneId;
  readonly report?: IReportSpec;
  /** Handled by the CLI rather than spawned: the e2e lane boots its own stack. */
  readonly e2eLane?: true;
  /**
   * Exit code this command uses for "I could not check", mapped to `blocked`
   * instead of `failed`. A check that judges itself needs a way to say "no
   * evidence" that is not the same as "evidence of a problem".
   */
  readonly blockedExitCode?: number;
}

export const CHECKS: readonly ICheckSpec[] = [
  {
    id: 'build-packages',
    profiles: STATIC,
    command: ['pnpm', 'build:packages'],
    manifestCommand: 'pnpm build:packages',
  },
  {
    id: 'lint',
    profiles: STATIC,
    command: ['pnpm', 'exec', 'turbo', 'lint'],
    manifestCommand: 'pnpm exec turbo lint',
  },
  {
    id: 'check-types',
    profiles: STATIC,
    command: ['pnpm', 'exec', 'turbo', 'check-types'],
    manifestCommand: 'pnpm exec turbo check-types',
  },
  {
    id: 'check-types-tools',
    profiles: STATIC,
    command: ['pnpm', 'check-types:tools'],
    manifestCommand: 'pnpm check-types:tools',
  },
  {
    id: 'lint-meta',
    profiles: STATIC,
    command: ['pnpm', 'lint:meta'],
    manifestCommand: 'pnpm lint:meta',
  },
  {
    id: 'lint-tools',
    profiles: STATIC,
    command: ['pnpm', 'lint:tools'],
    manifestCommand: 'pnpm lint:tools',
  },
  {
    id: 'test-lint-meta',
    profiles: STATIC,
    command: ['pnpm', 'test:lint-meta'],
    manifestCommand: 'pnpm test:lint-meta',
  },
  {
    id: 'lint-meta-docs',
    profiles: STATIC,
    command: ['pnpm', 'check:lint-meta-docs'],
    manifestCommand: 'pnpm check:lint-meta-docs',
  },
  { id: 'format', profiles: STATIC, command: ['pnpm', 'format:check'] },
  { id: 'contrast', profiles: STATIC, command: ['pnpm', 'check:contrast'] },
  { id: 'unit', profiles: FEATURE, command: ['pnpm', 'exec', 'turbo', 'test'] },
  {
    id: 'knip-api',
    profiles: FEATURE,
    command: ['pnpm', '--filter', '@repo/api', 'knip'],
    manifestCommand: 'pnpm --filter @repo/api knip',
  },
  {
    id: 'knip-web',
    profiles: FEATURE,
    command: ['pnpm', '--filter', '@repo/web', 'knip'],
    manifestCommand: 'pnpm --filter @repo/web knip',
  },
  {
    id: 'coverage-api',
    profiles: FEATURE,
    command: ['pnpm', '--filter', '@repo/api', 'test:cov:check'],
    manifestCommand: 'pnpm --filter @repo/api test:cov:check',
  },
  {
    id: 'coverage-web',
    profiles: FEATURE,
    command: ['pnpm', '--filter', '@repo/web', 'test:cov:check'],
    manifestCommand: 'pnpm --filter @repo/web test:cov:check',
  },
  {
    id: 'isolation',
    profiles: FEATURE,
    command: ['pnpm', '--filter', '@repo/api', 'test:integration'],
    lane: 'isolation',
    report: {
      kind: 'jest-json',
      file: '.agent-state/verification/isolation.json',
      args: ['--json', '--outputFile={{reportPath}}'],
    },
  },
  {
    id: 'prisma-migrate-check',
    profiles: FEATURE,
    command: ['pnpm', '--filter', '@repo/database', 'db:migrate:check'],
    manifestCommand: 'pnpm --filter @repo/database db:migrate:check',
    lane: 'prisma_gates',
  },
  {
    id: 'prisma-migrate-status',
    profiles: FEATURE,
    command: ['pnpm', '--filter', '@repo/database', 'db:migrate:status'],
    manifestCommand: 'pnpm --filter @repo/database db:migrate:status',
    lane: 'prisma_gates',
  },
  {
    // Every declared @noctcore range against the registry's latest: the half
    // lint:meta's offline `noctcore-packages-current` cannot see. Release only
    // and outside pre-push, so lint and CI never depend on the registry; an
    // unreachable registry exits 2, which is BLOCKED, never a pass.
    id: 'noctcore-published',
    profiles: RELEASE,
    command: ['pnpm', 'check:noctcore-published'],
    blockedExitCode: 2,
  },
  { id: 'size-budget', profiles: RELEASE, command: ['pnpm', 'size:check'] },
  {
    id: 'e2e',
    profiles: RELEASE,
    command: [],
    e2eLane: true,
    report: {
      kind: 'junit',
      file: 'apps/web/playwright-report/e2e-lane.junit.xml',
      args: [],
    },
  },
  {
    /*
     * The committed test inventory (tools/verify/inventories/). Last on
     * purpose: it reads the JUnit every suite above just wrote, so a case that
     * was deleted, skipped or duplicated is caught even though every one of
     * those runners exited 0. `--from-report` runs nothing itself. In `release`
     * that includes the e2e lane's report; in `feature`, which never boots a
     * browser, the e2e suite is left uncompared and the `e2e` check is what
     * reports the missing run.
     */
    id: 'inventory',
    profiles: FEATURE,
    command: ['pnpm', 'verify:inventory', '--from-report'],
    blockedExitCode: 2,
  },
];

export function checksFor(profile: Profile): readonly ICheckSpec[] {
  return CHECKS.filter((check) => check.profiles.includes(profile));
}
