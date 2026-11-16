/**
 * The isolation canary: `pnpm canary:isolation`.
 *
 * The isolation lane is the only proof that the tenant-scope Prisma extension is
 * a real boundary (there is no RLS), and many of its cases assert ABSENCE, which
 * also passes when a fixture never landed. Nothing showed that the lane FAILS
 * when isolation breaks.
 *
 * So this runs the lane once per mutant. A mutant is the production model
 * registry minus one model, selected through `ISOLATION_CANARY_DISABLE_MODEL`
 * and applied by the test-only seam in apps/api/test/tenant-scope-canary.ts. For
 * each one, `isolation-canary.json` names the cases that must go red; every
 * `control:` case must stay green, or the mutant proved nothing. A mutant no
 * named case catches is a surviving mutant and fails the run.
 *
 * It runs the lane 14 times, so it belongs in a release check rather than on
 * every push. Point DATABASE_URL at a throwaway database first:
 *
 *   docker exec saas-starter-postgres createdb -U postgres saas_starter_canary
 *   export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/saas_starter_canary
 *   pnpm --filter @repo/database db:migrate:deploy
 *   pnpm canary:isolation
 *
 * `--model=<name>` runs one mutant (plus the baseline), for debugging a single
 * entry without paying for the full sweep.
 *
 * This file orchestrates only: the judgment lives in `evaluate.ts`, which is
 * unit tested.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type ICanaryManifest,
  formatVerdict,
  judgeBaseline,
  judgeMutant,
  parseJestCases,
} from './evaluate';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const MANIFEST_PATH = join(HERE, 'isolation-canary.json');

/** The lane itself, run from the repo root through the api package's config. */
const JEST_ARGS = [
  '--filter',
  '@repo/api',
  'exec',
  'jest',
  '--config',
  'jest.integration.config.js',
];

/** Runs the whole isolation lane once and returns its cases. */
function runLane(mutant: string | undefined, reportPath: string) {
  const result = spawnSync('pnpm', [...JEST_ARGS, '--json', '--outputFile', reportPath], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      // What `pnpm --filter @repo/api test:integration` sets: jest needs the
      // flag for the native dynamic import of @repo/database. Set rather than
      // appended, because reading NODE_OPTIONS here would be an undeclared
      // turbo env var and nothing in this repo runs the lane with one.
      NODE_OPTIONS: '--experimental-vm-modules',
      ISOLATION_CANARY_DISABLE_MODEL: mutant ?? '',
    },
  });

  if (result.error !== undefined) {
    throw new Error(`Could not start jest: ${result.error.message}`);
  }

  let report: unknown;
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } catch {
    throw new Error(
      `The lane produced no jest report for mutant "${mutant ?? 'baseline'}". Its output was:\n${result.stderr}`,
    );
  }
  return parseJestCases(report);
}

function readManifest(): ICanaryManifest {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ICanaryManifest;
  if (typeof manifest.controlPrefix !== 'string' || typeof manifest.mutants !== 'object') {
    throw new Error(`${MANIFEST_PATH} is not a canary manifest (controlPrefix + mutants).`);
  }
  return manifest;
}

function main(): number {
  if ((process.env.DATABASE_URL ?? '') === '') {
    process.stderr.write(
      'DATABASE_URL must be EXPORTED and point at a throwaway database: the canary writes fixtures with tenant isolation deliberately broken.\n',
    );
    return 1;
  }

  const manifest = readManifest();
  const only = process.argv.find((arg) => arg.startsWith('--model='))?.slice('--model='.length);
  const mutants = Object.keys(manifest.mutants).filter(
    (model) => only === undefined || model === only,
  );
  if (mutants.length === 0) {
    process.stderr.write(
      `No mutant named "${String(only)}" in ${MANIFEST_PATH}. Known: ${Object.keys(manifest.mutants).join(', ')}.\n`,
    );
    return 1;
  }

  const reportDir = mkdtempSync(join(tmpdir(), 'saas-starter-canary-'));
  const lines: string[] = [];
  let failed = 0;

  try {
    process.stdout.write('isolation canary: baseline (no mutant)\n');
    const baseline = judgeBaseline(runLane(undefined, join(reportDir, 'baseline.json')));
    if (baseline.ok) {
      lines.push('PASS  baseline: the lane is green with the production registry');
    } else {
      failed += 1;
      lines.push('FAIL  baseline: the lane must be green before any mutant means anything');
      for (const name of baseline.failures) {
        lines.push(`        ${name}`);
      }
    }

    // A red baseline makes every verdict below meaningless, so stop there.
    if (baseline.ok) {
      for (const mutant of mutants) {
        process.stdout.write(`isolation canary: mutant ${mutant}\n`);
        const cases = runLane(mutant, join(reportDir, `${mutant}.json`));
        const expectation = manifest.mutants[mutant];
        if (expectation === undefined) {
          throw new Error(`Mutant "${mutant}" vanished from the manifest mid-run.`);
        }
        const verdict = judgeMutant(mutant, expectation, cases, manifest.controlPrefix);
        if (!verdict.ok) {
          failed += 1;
        }
        lines.push(...formatVerdict(verdict));
      }
    }
  } finally {
    rmSync(reportDir, { recursive: true, force: true });
  }

  process.stdout.write(`\n${lines.join('\n')}\n`);
  if (failed > 0) {
    process.stdout.write(
      `\n${String(failed)} canary check(s) failed. A surviving mutant means the isolation lane cannot see that model leaking: add the missing case.\n`,
    );
    return 1;
  }
  process.stdout.write(`\nAll ${String(mutants.length)} mutants killed, controls green.\n`);
  return 0;
}

process.exitCode = main();
