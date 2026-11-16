/**
 * Shared class strings for the public landing page.
 *
 * The landing CTAs are larger and rounder than the shadcn `Button` sizes
 * (`h-9`/`h-10`, `rounded-md`), so overriding `Button` would mean replacing
 * every one of its variant classes. These constants keep the design tokens in
 * one place instead.
 *
 * `type-heading-h3` (Instrument Sans 600 / 15px) is deliberate on button
 * labels: it is the token whose metrics match the design's CTA text, and the
 * token contract has no dedicated button style. `type-body-medium` would drop
 * the weight to 500.
 */

const CTA_BASE =
  'inline-flex items-center justify-center gap-2 rounded-xl type-heading-h3 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2';

/** Solid brand CTA used for every "Create an account" action. */
export const ctaPrimary = `${CTA_BASE} bg-brand px-6 py-3 text-brand-fg shadow-md hover:bg-brand-hover focus-visible:outline-brand`;

/** Bordered CTA that sits next to the primary one on a light background. */
export const ctaSecondary = `${CTA_BASE} border border-border bg-surface px-5 py-3 text-text-secondary hover:bg-hover focus-visible:outline-brand`;

/** Compact nav CTA. */
export const ctaNav =
  'inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2 type-body-medium text-brand-fg transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

/** Ghost nav link that shares the CTA focus treatment. */
export const navLink =
  'rounded-sm type-body-regular text-text-secondary transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand';
