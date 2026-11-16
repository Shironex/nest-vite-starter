#!/usr/bin/env node
/**
 * Coverage ratchet: a ratchet, not a wishlist.
 *
 * Reads a coverage-summary.json (jest or vitest, both emit the same
 * `total.lines.pct` / `total.functions.pct` shape via the json-summary
 * reporter) and exits non-zero when either metric falls below its floor.
 *
 * Raise the floors as coverage climbs. Never lower them to silence a
 * regression. To lower the threshold: do not.
 *
 * Usage:
 *   node scripts/check-coverage.mjs <summary.json> --lines <pct> --functions <pct>
 *
 *
 * Reads json-summary rather than the `All files |` text table: the table
 * differs between runners and breaks on jest + vitest, json-summary is
 * runner-agnostic.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function parseArgs(argv) {
  const [summaryArg, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    const value = rest[i + 1];
    if (key?.startsWith('--')) {
      flags[key.slice(2)] = value;
    }
  }
  return { summaryArg, flags };
}

function readFloor(raw, label) {
  if (raw === undefined) {
    fail(`Missing floor for ${label}. Pass --${label} <pct>.`);
  }
  const pct = Number(raw);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    fail(`Invalid ${label} floor "${raw}": expected a number between 0 and 100.`);
  }
  return pct;
}

function fail(message) {
  console.error(`[check-coverage] ${message}`);
  process.exit(1);
}

const { summaryArg, flags } = parseArgs(process.argv.slice(2));

if (!summaryArg) {
  fail('Missing coverage-summary.json path (first argument).');
}

const summaryPath = resolve(process.cwd(), summaryArg);
const minLines = readFloor(flags.lines, 'lines');
const minFunctions = readFloor(flags.functions, 'functions');

let total;
try {
  total = JSON.parse(readFileSync(summaryPath, 'utf8')).total;
} catch (error) {
  fail(`Could not read coverage summary at ${summaryPath}: ${error.message}`);
}

if (!total?.lines || !total?.functions) {
  fail(
    `Coverage summary at ${summaryPath} has no total.lines/total.functions; is the json-summary reporter enabled?`,
  );
}

const lines = total.lines.pct;
const functions = total.functions.pct;

const failures = [];
if (lines < minLines) {
  failures.push(`lines ${lines.toFixed(2)}% < floor ${minLines}%`);
}
if (functions < minFunctions) {
  failures.push(`functions ${functions.toFixed(2)}% < floor ${minFunctions}%`);
}

if (failures.length > 0) {
  console.error('[check-coverage] Coverage regressed below the ratchet floor:');
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  console.error('');
  console.error('  This is a ratchet, not a wishlist. Add tests to bring coverage back up.');
  console.error('  To lower the threshold: do not.');
  process.exit(1);
}

console.log(
  `[check-coverage] OK: lines ${lines.toFixed(2)}% (floor ${minLines}%), functions ${functions.toFixed(2)}% (floor ${minFunctions}%)`,
);
