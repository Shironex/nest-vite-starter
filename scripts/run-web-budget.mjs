#!/usr/bin/env node
/**
 * Runs a web budget gate (`size:check` or `lighthouse`) through turbo, so the
 * build it measures is always rebuilt from the current sources first.
 *
 * WHY THIS EXISTS. Both gates read `apps/web/dist` and nothing built it before
 * they ran. Run on their own they measured whatever `dist` a previous session
 * left behind: the byte budget once reported passing with 11.25 kB of headroom
 * when it was 51.95 kB over, because it had measured a two-day-old build. `turbo.json` now declares `@repo/web#size:check` and
 * `@repo/web#lighthouse` as dependents of `@repo/web#build`; this script is the
 * one entry point, so local runs and CI resolve the same graph.
 *
 * WHY THE DSN. `lib/error-reporting.ts` only imports the Sentry SDK when
 * `VITE_SENTRY_DSN` is a non-empty string, so a build without one tree-shakes
 * the lazy Sentry chunk away and the gate measures a bundle production does
 * not ship. The placeholder below is set unconditionally so every machine and
 * CI measure the same bundle. Nothing is sent anywhere: the artifact is
 * measured and discarded, and the deployed image gets the real DSN through the
 * Dockerfile ARG. `@repo/web#build` lists `VITE_SENTRY_DSN` in its turbo `env`,
 * so turbo never reuses a build made with a different value.
 *
 * Usage:
 *   node scripts/run-web-budget.mjs <size:check|lighthouse>
 */
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TASKS = new Set(['size:check', 'lighthouse']);
const BUDGET_SENTRY_DSN = 'https://0000000000000000000000000000000@o0.ingest.sentry.io/0';

const task = process.argv[2];
if (!TASKS.has(task)) {
  console.error(
    `[run-web-budget] Expected one of: ${[...TASKS].join(', ')} (got "${task ?? ''}").`,
  );
  process.exit(1);
}

/*
 * WHY THE DIST IS REMOVED FIRST. `size-limit` globs `dist/assets/*.js`, so it
 * measures every file sitting there, not the files one build produced. Anything
 * else that builds web into the same folder leaves its chunks behind under
 * different content hashes, and the gate then charges the app for both builds.
 *
 * `pnpm e2e:lane` is the one that does it: it builds without VITE_SENTRY_DSN, so
 * every hash differs from the DSN build measured here. Once that put 301 chunks in `dist` and reported 897.46 kB against a 600 kB ceiling, when the
 * real figure was 554.66 kB. The same root cause bites the other way when the gate
 * passes by measuring a two-day-old build.
 *
 * Removing the folder does not cost a rebuild: turbo restores `@repo/web#build`
 * outputs from its cache when the inputs are unchanged.
 */
const distDir = join(dirname(dirname(fileURLToPath(import.meta.url))), 'apps', 'web', 'dist');
rmSync(distDir, { recursive: true, force: true });

const result = spawnSync('pnpm', ['exec', 'turbo', task, '--filter=@repo/web'], {
  stdio: 'inherit',
  // pnpm is a .cmd shim on Windows, which spawn cannot resolve without a shell.
  shell: process.platform === 'win32',
  env: { ...process.env, VITE_SENTRY_DSN: BUDGET_SENTRY_DSN },
});

if (result.error) {
  console.error(`[run-web-budget] Could not start turbo: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
