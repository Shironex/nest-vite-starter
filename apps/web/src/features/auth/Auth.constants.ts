/**
 * Shared SaaS Starter presentation classes for the auth screens.
 *
 * These exist because the pieces they style live in `@repo/ui` and are shaped
 * for the generic shadcn defaults (a 36px button, a 6px radius). The auth
 * screens need the treatment from the design (40/42px controls on a 10px
 * radius), and keeping the override in one constant beats repeating the same
 * class string across five forms. If `@repo/ui` ever grows a SaaS Starter-native
 * button/input size, these collapse into that instead.
 */

/** Full-width primary submit, matching the 42px CTA in the design's form column. */
export const AUTH_SUBMIT_CLASS =
  'type-body-medium! h-10.5 w-full rounded-lg bg-brand text-brand-fg shadow-none hover:bg-brand-hover';

/** Brand-coloured inline link, used in headers and under the submit button. */
export const AUTH_LINK_CLASS =
  'rounded-sm font-medium text-brand-ink transition-colors hover:text-brand-ink-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

/** The quieter link treatment for "back to sign in" style navigation. */
export const AUTH_MUTED_LINK_CLASS =
  'type-body-small rounded-sm text-text-muted transition-colors hover:text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';
