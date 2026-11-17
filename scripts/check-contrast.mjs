#!/usr/bin/env node
/**
 * Contrast contract checker.
 *
 * Every WCAG ratio the design system promises used to be measured by hand, which is exactly how the two brand-token AA failures shipped:
 * a token was asked to be both a fill under white text and ink on a dark plate,
 * and nobody noticed the two jobs pull luminance in opposite directions. This
 * script makes those measurements executable so the next drift fails a command
 * instead of a user's eyes.
 *
 * It reads the design token blocks straight out of
 * packages/ui/src/styles/globals.css, so there is one source of truth: change a
 * token and the numbers here move with it. Nothing is hardcoded except the
 * pairings and their thresholds.
 *
 * Usage:
 *   node scripts/check-contrast.mjs           # table + exit 1 on any failure
 *   node scripts/check-contrast.mjs --quiet   # only print failures
 *
 * Exits non-zero when a pairing marked as required drops below its threshold,
 * when a pairing marked `exempt` starts clearing AA in BOTH modes (a stale
 * exemption is a lie in the contract just as much as a stale ratio), or when an
 * oklch value stops matching the hex in its own trailing comment.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = resolve(HERE, '../packages/ui/src/styles/globals.css');

// WCAG 2.1 SC 1.4.3. Large text is 24px, or 18.66px at weight 700; in the
// SaaS Starter ramp only type-display-hero, type-display-large and type-stat-figure
// clear that bar, so 4.5 is the default for every pairing here. Set `min: 3` on
// a pairing only if it is provably unreachable by anything smaller.
const AA_SMALL = 4.5;

// --- color maths ---------------------------------------------------------
// oklch -> OKLab -> LMS -> linear sRGB, per the CSS Color 4 matrices.

function oklchToLinearSrgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const lRoot = L + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = L - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = L - 0.0894841775 * a - 1.291485548 * b;

  const l = lRoot ** 3;
  const m = mRoot ** 3;
  const s = sRoot ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const gammaEncode = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const gammaDecode = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/**
 * What the display actually shows. The gamut clip matters: several SaaS Starter
 * oklch values sit outside sRGB and the browser clips them before compositing,
 * so measuring the unclipped linear values would disagree with the screen.
 */
function oklchToRgb8(L, C, h) {
  return oklchToLinearSrgb(L, C, h).map((v) => Math.round(gammaEncode(clamp01(v)) * 255));
}

const toHex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((v) => gammaDecode(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fg, bg) {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Tailwind's `bg-primary/90` composites in GAMMA space, not linear: the browser
 * blends the 8-bit sRGB channels directly. Getting this wrong makes an alpha
 * pairing disagree with the rendered pixel by a visible margin.
 */
function composite(fg, bg, alpha) {
  return fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)));
}

// --- token parsing --------------------------------------------------------

/**
 * Pulls one selector's `--name: oklch(L C H)` declarations out of the
 * stylesheet. Matched on the exact selector line so the seven alternate theme
 * blocks (violet, ocean, ...) cannot leak into the measurements.
 */
function parseTokenBlock(css, selector) {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`selector not found in globals.css: ${selector}`);
  const end = css.indexOf('\n}', start);
  const block = css.slice(start, end);

  const tokens = new Map();
  const drift = [];
  const decl =
    /--([\w-]+):\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\);(?:\s*\/\*([^*]*)\*\/)?/g;
  let match;
  while ((match = decl.exec(block)) !== null) {
    const [, name, L, C, h, comment] = match;
    const rgb = oklchToRgb8(Number(L), Number(C), Number(h));
    tokens.set(name, rgb);

    // Those `/* color/brand/primary #4f68ec */` comments are how a designer
    // reads this file. Hold them to the maths so they cannot rot silently.
    const documented = comment?.match(/#([0-9a-f]{6})\b/i);
    if (documented && `#${documented[1].toLowerCase()}` !== toHex(rgb)) {
      drift.push(`--${name} is documented as #${documented[1]} but computes to ${toHex(rgb)}`);
    }
  }
  if (tokens.size === 0) throw new Error(`no oklch tokens parsed from ${selector}`);
  return { tokens, drift };
}

// --- the contract ---------------------------------------------------------
// The contrast contract itself: every pairing a screen uses. `min` is the bar
// the pairing must clear; `exempt` records a pairing that is known to fail and
// says why, in which case the ratio is reported but not enforced.

/** @type {{ink: string, bg: string, alpha?: number, over?: string, min?: number, exempt?: string, label?: string}[]} */
const PAIRINGS = [
  // Brand ink on every SaaS Starter surface.
  { ink: 'brand-ink', bg: 'brand-tint' },
  { ink: 'brand-ink', bg: 'brand-50' },
  { ink: 'brand-ink', bg: 'brand-100' },
  { ink: 'brand-ink', bg: 'surface' },
  { ink: 'brand-ink', bg: 'bg-app' },
  { ink: 'brand-ink', bg: 'surface-subtle' },
  { ink: 'brand-ink', bg: 'surface-hover' },

  // The ink's hover partner is brand-ink-hover, not brand-hover: the fill token
  // is dark enough that it cannot carry text.
  { ink: 'brand-ink-hover', bg: 'brand-tint' },
  { ink: 'brand-ink-hover', bg: 'brand-50' },
  { ink: 'brand-ink-hover', bg: 'surface' },
  { ink: 'brand-ink-hover', bg: 'bg-app' },
  { ink: 'brand-ink-hover', bg: 'surface-subtle' },
  // `card` currently equals `surface`, but ink links on the Card primitive
  // (dashboard counters, DashboardPage) sit on a surface that binds
  // bg-card. Asserted separately so decoupling the two cannot move them quietly.
  { ink: 'brand-ink', bg: 'card' },
  { ink: 'brand-ink-hover', bg: 'card' },

  // Brand as a fill under white, and the pairing the fill-versus-ink split exists
  // to protect. These two also assert BrandPanel's subheadline and trust line,
  // which carry no alpha: `text-white` is `--brand-fg` in both modes and the
  // panel's gradient runs between exactly these two tokens, so the pair brackets
  // every point on that ramp. Dark `brand` is the worst point at 4.64:1, about 3%
  // over AA, so there is no slack to give away here.
  { ink: 'brand-fg', bg: 'brand' },
  { ink: 'brand-fg', bg: 'brand-hover' },
  { ink: 'brand', bg: 'brand-fg' },

  // The shared Button, which the bug report wrongly blamed. It hovers with
  // `bg-primary/90` over the card, never with bg-brand-hover, and it passes.
  // Asserted here so that claim stops being a matter of opinion.
  { ink: 'primary-foreground', bg: 'primary', label: 'primary-foreground on bg-primary' },
  {
    ink: 'primary-foreground',
    bg: 'primary',
    alpha: 0.9,
    over: 'card',
    label: 'primary-foreground on bg-primary/90 over card',
  },
  {
    ink: 'primary-foreground',
    bg: 'primary',
    alpha: 0.9,
    over: 'background',
    label: 'primary-foreground on bg-primary/90 over background',
  },

  // Text ramp on the brand tint, the pairing set most likely to be reached for.
  { ink: 'text-secondary', bg: 'brand-tint' },
  { ink: 'text-primary', bg: 'surface' },
  { ink: 'text-secondary', bg: 'surface' },
  { ink: 'text-muted', bg: 'surface' },
  // StatusPill's `neutral` tone, the default one. It is the only tone that does
  // not use a semantic ink (`bg-subtle text-text-secondary`), which is precisely
  // why it was the tone nobody thought to list.
  { ink: 'text-secondary', bg: 'surface-subtle' },

  // The semantic tones. This block exists because the brand ramp above was
  // audited pairing-by-pairing while the state colors were never listed at all,
  // so `text-warning` on `bg-warning-bg` shipped at 3.96:1 in Light through four
  // compliance screens with the suite green. Every semantic ink is asserted on
  // its own tint AND on all four neutral surfaces it can land on, because a tone
  // is reached for as a bare `text-*` on a card at least as often as it is used
  // inside its matching pill. Enumerated exhaustively rather than by call site:
  // the point of this block is to cover the pairing nobody thought of yet.
  { ink: 'warning', bg: 'warning-bg' },
  { ink: 'warning', bg: 'bg-app' },
  { ink: 'warning', bg: 'surface' },
  { ink: 'warning', bg: 'surface-subtle' },
  { ink: 'warning', bg: 'card' },

  { ink: 'success', bg: 'success-bg' },
  { ink: 'success', bg: 'bg-app' },
  { ink: 'success', bg: 'surface' },
  { ink: 'success', bg: 'surface-subtle' },
  { ink: 'success', bg: 'card' },

  { ink: 'danger', bg: 'danger-bg' },
  { ink: 'danger', bg: 'bg-app' },
  { ink: 'danger', bg: 'surface' },
  { ink: 'danger', bg: 'surface-subtle' },
  { ink: 'danger', bg: 'card' },

  // danger-strong is the FormError / TwoFactorChallenge ink and exists in both
  // modes, so it is held to the same bar as the tone it strengthens.
  { ink: 'danger-strong', bg: 'danger-bg' },
  { ink: 'danger-strong', bg: 'bg-app' },
  { ink: 'danger-strong', bg: 'surface' },
  { ink: 'danger-strong', bg: 'surface-subtle' },
  { ink: 'danger-strong', bg: 'card' },

  // purple has no `text-purple` call site today, only the swatch in
  // tokens.stories.tsx. Asserted anyway so the first consumer inherits a
  // measured token instead of discovering its ratio in review.
  { ink: 'purple', bg: 'purple-bg' },
  { ink: 'purple', bg: 'bg-app' },
  { ink: 'purple', bg: 'surface' },
  { ink: 'purple', bg: 'surface-subtle' },
  { ink: 'purple', bg: 'card' },

  // Both clear AA in both modes, so they are enforced rather than excused. A
  // state still belongs on its own tint rather than the brand tint, but that is
  // a taste rule, not a contrast rule, and the checker only speaks to the
  // second.
  { ink: 'danger', bg: 'brand-tint' },
  { ink: 'success', bg: 'brand-tint' },

  // The destructive Button and Badge, which are the one place the app DOES draw
  // text on a solid tone fill. `--danger-strong-fg` is white in Light and the
  // near-black surface in Dark precisely because white cannot survive the Dark
  // fill; these two rows are what stops the pairing regressing to `text-white`.
  { ink: 'danger-strong-fg', bg: 'danger-strong' },

  // The semantic tones in their FILL role (white text on the solid color)
  // have no entries here, because the app draws white on a tone fill nowhere:
  // LandingHero's mock avatars sit on `bg-*-bg` + `text-*`, the tinted pairs
  // asserted above. There is no exemption either, since an exemption records
  // something the app does, whereas the structural reason white-on-tone cannot
  // work in Dark is design guidance and lives in the contract instead. Do not
  // add `text-brand-fg` on `bg-success` and friends: it is 1.84:1 to 3.05:1 in
  // Dark, since a Dark tone value is a bright tint whose job is to be ink on a
  // dark plate and it therefore cannot also carry white text.

  // Known failures. Each one is load-bearing documentation: it names the
  // wrong-looking pairing so nobody reaches for it by accident.
  { ink: 'brand', bg: 'brand-tint', exempt: 'use brand-ink' },
  { ink: 'brand', bg: 'surface', exempt: 'use brand-ink' },
  { ink: 'brand', bg: 'bg-app', exempt: 'use brand-ink' },
  { ink: 'brand-ink', bg: 'brand-fg', exempt: 'white plate wants text-brand' },
  // Both BrandPanel monogram chips. `brand-100` is the ProductScene avatar,
  // inside that subtree's `aria-hidden`. `brand-200` is the trust-row chip,
  // which sits below the headline and is hidden by its own wrapper rather than
  // by an ancestor. Assert that wrapper in BrandPanel.test.tsx, not just here:
  // this entry only proves the pairing still fails, never that the reason for
  // exempting it still holds.
  {
    ink: 'brand-ink-hover',
    bg: 'brand-100',
    exempt: 'BrandPanel decoration, aria-hidden',
  },
  {
    ink: 'brand-ink-hover',
    bg: 'brand-200',
    exempt: 'BrandPanel decoration, aria-hidden',
  },
  // The BrandPanel wordmark chip: `bg-white/20` over the gradient, carrying the
  // white `S`. 4.19:1 in Light and 3.29:1 in Dark, and the worst point of the
  // ramp is the `from-brand` end, which is exactly the corner the chip sits in,
  // so the endpoint below is the honest sample rather than the flattering one.
  // Exempt under the WCAG 1.4.3 logotype exception: the glyph is the SaaS Starter
  // mark. The wordmark TEXT beside it is plain white on the gradient and is
  // covered by `brand-fg on brand` above at 4.64:1.
  {
    ink: 'brand-fg',
    bg: 'brand-fg',
    alpha: 0.2,
    over: 'brand',
    label: 'brand-fg on white/20 over brand (wordmark)',
    exempt: 'logotype, WCAG 1.4.3 exception',
  },
  {
    ink: 'brand-ink-hover',
    bg: 'surface-hover',
    exempt: 'no call site pairs them, see the contract',
  },
  { ink: 'text-muted', bg: 'brand-tint', exempt: 'use text-secondary' },

  // The scrollbar thumb, which is the one entry here that is NOT text. Held to
  // WCAG 1.4.11's 3:1 for a non-text control rather than 4.5:1, on all three
  // surfaces a scroll container can sit on, because the report that produced
  // the token was a drawer scrolling under a sheet: the user has to be able to
  // tell which pane moves. A thumb tuned quieter than this stops being an
  // affordance and becomes a smudge, so the floor is enforced in both modes and
  // this is the row that catches a later "make it subtler" from going too far.
  { ink: 'scrollbar-thumb', bg: 'surface', min: 3 },
  { ink: 'scrollbar-thumb', bg: 'bg-app', min: 3 },
  { ink: 'scrollbar-thumb', bg: 'surface-subtle', min: 3 },
];

// Separation checks: a hover state has to be *seen*, not just measured. Both
// modes darken on hover, so the fill must stay clearly below its resting value.
const MIN_HOVER_LUMINANCE_DELTA = 0.2;
const SEPARATIONS = [{ resting: 'brand', hover: 'brand-hover', min: MIN_HOVER_LUMINANCE_DELTA }];

/**
 * Tokens that are two names for one design variable. A duplicated literal drifts
 * the moment one copy is retuned, which is how `text-destructive` would have
 * kept an older red while `text-danger-strong` moved, on the same screens.
 */
const ALIASED = [['destructive', 'danger-strong', 'color/danger/strong']];

// --- run ------------------------------------------------------------------

function resolveColor(tokens, spec) {
  const base = tokens.get(spec.bg);
  if (!base) throw new Error(`unknown token: --${spec.bg}`);
  if (spec.alpha === undefined) return base;
  const over = tokens.get(spec.over);
  if (!over) throw new Error(`unknown token: --${spec.over}`);
  return composite(base, over, spec.alpha);
}

function measure(tokens) {
  return PAIRINGS.map((spec) => {
    const ink = tokens.get(spec.ink);
    if (!ink) throw new Error(`unknown token: --${spec.ink}`);
    const bg = resolveColor(tokens, spec);
    const min = spec.min ?? AA_SMALL;
    const ratio = contrastRatio(ink, bg);
    const label =
      spec.label ??
      `${spec.ink} on ${spec.bg}${spec.alpha === undefined ? '' : `/${spec.alpha * 100} over ${spec.over}`}`;
    return {
      label,
      ratio,
      min,
      exempt: spec.exempt,
      inkHex: toHex(ink),
      bgHex: toHex(bg),
      pass: ratio >= min,
    };
  });
}

function separations(tokens) {
  return SEPARATIONS.map(({ resting, hover, min }) => {
    const restLum = relativeLuminance(tokens.get(resting));
    const hoverLum = relativeLuminance(tokens.get(hover));
    const delta = Math.abs(restLum - hoverLum) / restLum;
    return { resting, hover, restLum, hoverLum, delta, min, pass: delta >= min };
  });
}

const quiet = process.argv.includes('--quiet');
const css = readFileSync(CSS_PATH, 'utf8');
const MODES = [
  { name: 'Light', selector: "[data-theme='starter']" },
  { name: 'Dark', selector: "[data-theme='starter'].dark" },
];

const failures = [];
/** Per-pairing pass/fail across every mode, so exemptions are judged globally. */
const passesByPairing = PAIRINGS.map(() => []);

for (const mode of MODES) {
  const { tokens, drift } = parseTokenBlock(css, mode.selector);
  const rows = measure(tokens);
  rows.forEach((row, i) => passesByPairing[i].push(row.pass));

  for (const entry of drift) failures.push(`${mode.name}: ${entry}`);

  if (!quiet) {
    console.log(`\n${mode.name} (${mode.selector})`);
    console.log(`  ${'pairing'.padEnd(52)} ${'ratio'.padStart(7)}  status`);
    for (const row of rows) {
      const status = row.exempt
        ? `exempt (${row.exempt})`
        : row.pass
          ? `pass (>= ${row.min})`
          : `FAIL (< ${row.min})`;
      console.log(
        `  ${row.label.padEnd(52)} ${`${row.ratio.toFixed(2)}:1`.padStart(7)}  ${status}`,
      );
    }
  }

  for (const row of rows) {
    if (!row.exempt && !row.pass) {
      failures.push(`${mode.name}: ${row.label} is ${row.ratio.toFixed(2)}:1, needs ${row.min}:1`);
    }
  }

  for (const sep of separations(tokens)) {
    if (!quiet) {
      console.log(
        `  ${`${sep.hover} vs ${sep.resting} luminance separation`.padEnd(52)} ${`${(sep.delta * 100).toFixed(1)}%`.padStart(7)}  ${
          sep.pass ? `pass (>= ${sep.min * 100}%)` : `FAIL (< ${sep.min * 100}%)`
        }`,
      );
    }
    if (!sep.pass) {
      failures.push(
        `${mode.name}: ${sep.hover} is only ${(sep.delta * 100).toFixed(1)}% off ${sep.resting} in luminance, needs ${sep.min * 100}% to read as a state change`,
      );
    }
  }

  for (const [alias, canonical, variable] of ALIASED) {
    const aliasHex = toHex(tokens.get(alias));
    const canonicalHex = toHex(tokens.get(canonical));
    const ok = aliasHex === canonicalHex;
    if (!quiet) {
      console.log(
        `  ${`--${alias} tracks --${canonical}`.padEnd(52)} ${aliasHex.padStart(7)}  ${ok ? `matches (${variable})` : `DRIFTED from ${canonicalHex}`}`,
      );
    }
    if (!ok) {
      failures.push(
        `${mode.name}: --${alias} is ${aliasHex} but --${canonical} is ${canonicalHex}; both are ${variable}`,
      );
    }
  }
}

// An exemption earns its place by failing somewhere. Most of these fail in only
// one mode (`text-brand` on the tint is 5.62:1 in Light and 3.42:1 in Dark),
// so the test is "passes in every mode", not "passes in this mode".
PAIRINGS.forEach((spec, i) => {
  if (spec.exempt && passesByPairing[i].every(Boolean)) {
    const label = spec.label ?? `${spec.ink} on ${spec.bg}`;
    failures.push(
      `${label} now clears AA in every mode but is still recorded as exempt (${spec.exempt}). Promote it in the contract and drop the exemption.`,
    );
  }
});

if (failures.length > 0) {
  console.error('\n[check-contrast] The token contract is violated:');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error('');
  console.error('  Fix the token, not the threshold. If a pairing genuinely cannot clear AA,');
  console.error(
    '  it needs an `exempt` entry with a written reason in scripts/check-contrast.mjs.',
  );
  process.exit(1);
}

console.log(
  `\n[check-contrast] OK: ${PAIRINGS.length} pairings x ${MODES.length} modes, ` +
    `${SEPARATIONS.length} hover separation, ` +
    `${ALIASED.length * MODES.length} aliased tokens.`,
);
