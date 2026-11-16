#!/usr/bin/env node
/**
 * Initial-load byte budget: the bytes a browser actually fetches before
 * first paint, not the sum of everything the build emitted.
 *
 * Route-level code splitting is on (`autoCodeSplitting` in the router plugin),
 * so a `dist/assets/*.js` glob is the wrong gate: it adds every lazy route
 * chunk to the entry and calls the sum a regression, which means the number gets
 * WORSE every time a feature is split correctly.
 *
 * What a browser pays on first load is the entry module, the chunks the build
 * lists as `modulepreload`, any classic script in the document, and every
 * render-blocking stylesheet. The stylesheet is not an afterthought here: a
 * plain `<link rel="stylesheet">` blocks paint outright, so leaving it out
 * would measure everything except the asset with the most direct claim on
 * first paint.
 *
 * Compression is brotli at quality 11, per file, matching what size-limit
 * reports for the same output.
 *
 * Usage:
 *   node scripts/check-initial-bundle.mjs <dist-dir> --limit <kB>
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { brotliCompressSync, constants } from 'node:zlib';
import { resolve, join, dirname } from 'node:path';

function fail(message) {
  console.error(`[check-initial-bundle] ${message}`);
  process.exit(1);
}

const [distArg, ...rest] = process.argv.slice(2);
if (!distArg) {
  fail('Missing dist directory (first argument).');
}

const flags = {};
for (let i = 0; i < rest.length; i += 2) {
  if (rest[i]?.startsWith('--')) flags[rest[i].slice(2)] = rest[i + 1];
}

const limitKb = Number(flags.limit);
if (!Number.isFinite(limitKb) || limitKb <= 0) {
  fail(`Invalid --limit "${flags.limit}": expected a positive number of kB.`);
}

const distDir = resolve(process.cwd(), distArg);
const htmlPath = join(distDir, 'index.html');
if (!existsSync(htmlPath)) {
  fail(`No index.html at ${htmlPath}. Build the app before checking its budget.`);
}

/*
 * A dist older than the sources it was built from measures a different commit.
 * `index.html` merely EXISTING is not enough of a precondition: a two-day-old
 * build satisfies it happily, and a first-paint number reported for the wrong
 * commit is worse than no number, because it passes.
 *
 * Skipped under CI, where the workflow builds immediately before this step and
 * the step order is the guarantee. mtimes there come from a checkout and a
 * possible turbo cache restore, so comparing them would risk a red build for a
 * reason that has nothing to do with bytes.
 */
const SOURCE_SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage', '.git']);

function newestMtime(dir) {
  let newest = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return newest;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SOURCE_SKIP_DIRS.has(entry.name)) continue;
      newest = Math.max(newest, newestMtime(join(dir, entry.name)));
    } else if (entry.isFile()) {
      try {
        newest = Math.max(newest, statSync(join(dir, entry.name)).mtimeMs);
      } catch {
        // A file that vanished mid-walk cannot make the build stale.
      }
    }
  }
  return newest;
}

if (!process.env.CI) {
  const packageDir = dirname(distDir);
  const repoRoot = resolve(packageDir, '..', '..');
  const sourceRoots = [join(packageDir, 'src')];
  const packagesDir = join(repoRoot, 'packages');
  try {
    for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) sourceRoots.push(join(packagesDir, entry.name, 'src'));
    }
  } catch {
    // Not a monorepo layout; the app's own src is enough.
  }

  const builtAt = statSync(htmlPath).mtimeMs;
  const staleAgainst = sourceRoots.filter(
    (root) => existsSync(root) && newestMtime(root) > builtAt,
  );

  if (staleAgainst.length > 0) {
    fail(
      `${htmlPath} is older than its sources (${staleAgainst
        .map((root) => root.replace(`${repoRoot}/`, ''))
        .join(', ')}), so this would weigh a build of a different commit. ` +
        'Build first: `pnpm exec turbo build --filter=@repo/web`.',
    );
  }
}

const html = readFileSync(htmlPath, 'utf8');

/*
 * The entry <script type="module" src>, every <link rel="modulepreload">, and
 * any other local classic script in the document. Cross-origin URLs are somebody
 * else's bytes and are skipped; we can only weigh what we ship.
 */
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
const preloads = [...html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/g)].map(
  (m) => m[1],
);
/*
 * Stylesheets are counted but NOT required: a build is free to inline its CSS,
 * and demanding a link would fail on one that does. A `media` attribute is
 * left alone deliberately: `media="print"` does not block paint, but this
 * app ships one unconditional stylesheet and a rule guessing at media queries
 * would be more likely to be wrong than useful. If that changes, narrow this.
 */
const stylesheets = [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"/g)].map(
  (m) => m[1],
);

/*
 * A parser that quietly matches nothing would report a tiny number and pass
 * forever, which is the failure mode this gate exists to prevent. So the shape
 * of the document is asserted, not assumed: a Vite build of this app always
 * emits one module entry AND a preload set. If either disappears, the build
 * changed in a way that invalidates the measurement, and that is worth failing
 * on rather than measuring around.
 */
if (scripts.length === 0) {
  fail(
    'index.html has no <script src>; the parser matched nothing, so the budget would be meaningless.',
  );
}
if (preloads.length === 0) {
  fail(
    'index.html lists no <link rel="modulepreload">; either the build stopped emitting them or the ' +
      'markup changed shape. Both invalidate this measurement; fix the parser rather than trusting the number.',
  );
}

const referenced = new Set([...scripts, ...preloads, ...stylesheets]);

const entries = [];
const missing = [];
for (const ref of referenced) {
  if (/^(?:https?:)?\/\//.test(ref)) continue;
  const filePath = join(distDir, ref.replace(/^\//, '').split('?')[0]);
  if (!existsSync(filePath)) {
    missing.push(ref);
    continue;
  }
  const bytes = brotliCompressSync(readFileSync(filePath), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;
  entries.push({ ref, bytes });
}

if (missing.length > 0) {
  fail(`index.html references files that are not in the build: ${missing.join(', ')}`);
}
if (entries.length === 0) {
  fail('index.html references no local scripts; the parser found nothing to weigh.');
}

entries.sort((a, b) => b.bytes - a.bytes);
const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
const limitBytes = Math.round(limitKb * 1000);
const asKb = (bytes) => `${(bytes / 1000).toFixed(2)} kB`;

console.log(
  `[check-initial-bundle] initial load: ${asKb(total)} brotli across ${entries.length} files (limit ${limitKb} kB)`,
);
for (const entry of entries.slice(0, 8)) {
  console.log(`    ${asKb(entry.bytes).padStart(10)}  ${entry.ref}`);
}
if (entries.length > 8) {
  const restBytes = entries.slice(8).reduce((sum, entry) => sum + entry.bytes, 0);
  console.log(`    ${asKb(restBytes).padStart(10)}  (${entries.length - 8} smaller files)`);
}

if (total > limitBytes) {
  console.error('');
  console.error(
    `[check-initial-bundle] Over budget by ${asKb(total - limitBytes)}. This is what users download before first paint.`,
  );
  console.error(
    '  Moving code into a lazily loaded route chunk fixes this honestly. Raising the limit does not.',
  );
  process.exit(1);
}

console.log(`[check-initial-bundle] OK: ${asKb(limitBytes - total)} of headroom.`);
