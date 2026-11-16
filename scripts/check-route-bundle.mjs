#!/usr/bin/env node
/*
 * What one route actually costs a visitor, beyond the shell they already have.
 *
 * WHY A SEPARATE SCRIPT. `@size-limit/file` matches file GLOBS, and a route's
 * real weight is its transitive static-import CLOSURE: the dozens of chunks a
 * heavy route pulls are hash-named and named after their own source modules,
 * so no glob can express them. The size-limit entries in
 * `apps/web/.size-limit.json` gate each route's OWN chunks, which is the thing
 * that regresses when a route pulls a large module or a library eagerly, and each entry's
 * name says so rather than implying more. This is the number those entries
 * cannot state.
 *
 * A WARNING, NOT A GATE, and deliberately so. The closure moves for reasons
 * that are not regressions: splitting a chunk correctly can raise a route's
 * count while lowering everything else, and a shared chunk crossing the shell
 * boundary moves several routes at once. A hard failure here would be a build
 * that goes red for a change that improved the app. It always exits 0; read the
 * numbers, and move a baseline below when a change explains itself.
 *
 * Usage: `node scripts/check-route-bundle.mjs` after `pnpm --filter @repo/web build`.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'apps/web/dist');
const ASSETS = join(DIST, 'assets');

/**
 * Baselines, measured on the tree. "Beyond the
 * shell" means the closure of the route's own chunks minus everything the entry
 * and the authenticated shell already pulled, so it is what a NAVIGATION costs
 * rather than what a cold load costs.
 */
const BASELINES = [
  // Unauthenticated: only the html entry closure is already paid for.
  { route: '/auth/login', chunk: /^login-/, authenticated: false, beyondKb: 33.3, coldKb: 204.9 },
  { route: '/dashboard', chunk: /^dashboard-/, authenticated: true, beyondKb: 6.7, coldKb: 239.6 },
  { route: '/audit', chunk: /^audit-/, authenticated: true, beyondKb: 52.8, coldKb: 285.8 },
];

/** Tolerance before a route is called out. Chunk hashes and gzip noise move a few hundred bytes. */
const TOLERANCE_KB = 5;

function brotli(buffer) {
  return brotliCompressSync(buffer, {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;
}

/** Static import specifiers of one emitted chunk, as bare file names. */
function staticImports(source) {
  const names = new Set();
  // Vite emits `import "./chunk-x.js"` and `from"./chunk-x.js"` in the same build.
  for (const match of source.matchAll(/(?:^|[^.\w])(?:import|from)\s*["']\.\/([^"']+\.js)["']/gu)) {
    names.add(match[1]);
  }
  return names;
}

function closure(entries, graph) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length > 0) {
    const name = queue.pop();
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);
    for (const next of graph.get(name) ?? []) queue.push(next);
  }
  return seen;
}

function main() {
  if (!existsSync(ASSETS)) {
    console.error(
      '[check-route-bundle] No dist/assets. Run `pnpm --filter @repo/web build` first.',
    );
    process.exit(0);
  }

  const files = readdirSync(ASSETS).filter((file) => file.endsWith('.js'));
  const graph = new Map();
  const sizes = new Map();
  for (const file of files) {
    const source = readFileSync(join(ASSETS, file), 'utf8');
    graph.set(file, staticImports(source));
    sizes.set(file, brotli(Buffer.from(source)));
  }

  // The shell every authenticated visit already paid for: the html entry plus
  // the _authenticated layout chunk and everything they statically pull.
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  const entryNames = [...html.matchAll(/\/assets\/([^"']+\.js)/gu)].map((m) => m[1]);
  const shellNames = files.filter((file) => /^_authenticated-/.test(file));
  const entryShell = closure(entryNames, graph);
  const authShell = closure([...entryNames, ...shellNames], graph);

  for (const [label, set] of [
    ['entry', entryShell],
    ['authenticated shell', authShell],
  ]) {
    const kb = [...set].reduce((sum, file) => sum + (sizes.get(file) ?? 0), 0) / 1024;
    console.log(`[check-route-bundle] ${label}: ${kb.toFixed(2)} kB br across ${set.size} chunks`);
  }

  for (const baseline of BASELINES) {
    const shell = baseline.authenticated ? authShell : entryShell;
    const own = files.filter((file) => baseline.chunk.test(file));
    if (own.length === 0) {
      console.log(`[check-route-bundle] ${baseline.route}: no chunk matched, skipped`);
      continue;
    }
    const beyond = [...closure(own, graph)].filter((file) => !shell.has(file));
    const beyondKb = beyond.reduce((sum, file) => sum + (sizes.get(file) ?? 0), 0) / 1024;
    const shellKb = [...shell].reduce((sum, file) => sum + (sizes.get(file) ?? 0), 0) / 1024;
    const coldKb = shellKb + beyondKb;
    /*
     * COLD is the number that means something to a person: everything a visitor
     * downloads to see this route from nothing. BEYOND is what a navigation
     * from elsewhere in the app costs, and it moves in the OPPOSITE direction
     * when a chunk is correctly pushed out of the shell, so the two are read
     * together or not at all.
     */
    const delta = coldKb - baseline.coldKb;
    const verdict =
      delta > TOLERANCE_KB
        ? `OVER baseline by ${delta.toFixed(2)} kB`
        : `within ${baseline.coldKb} kB`;
    console.log(
      `[check-route-bundle] ${baseline.route}: cold ${coldKb.toFixed(2)} kB br (${verdict}), ${beyondKb.toFixed(2)} kB br across ${beyond.length} chunks beyond the shell (baseline ${baseline.beyondKb})`,
    );
  }
}

main();
