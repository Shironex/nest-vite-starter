import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * The 14 SaaS Starter type ramp utilities, defined as `@utility type-*` in
 * `styles/globals.css`. Kept in sync with the ramp by hand: there is no way to
 * read `@utility` names out of the stylesheet at runtime.
 */
const STARTER_TYPE_UTILITIES = [
  'display-hero',
  'display-large',
  'display-wordmark',
  'stat-figure',
  'heading-h1',
  'heading-h2',
  'heading-h3',
  'body-regular',
  'body-medium',
  'body-strong',
  'body-small',
  'label-caption',
  'label-overline',
  'mono-small',
] as const;

/*
 * Registering the ramp as a tailwind-merge class group is what makes
 * `cn(base, consumerClassName)` resolve typography the way an author reads it.
 *
 * tailwind-merge only knows the stock Tailwind class groups. Left unextended it
 * treats each `type-*` utility as an unrelated class and keeps every one of
 * them, and since a `type-*` utility bundles family + weight + size + line
 * height + tracking, two of them on one element then fight in the stylesheet.
 * Tailwind emits custom `@utility` rules ahead of the core `text-*` / `font-*`
 * utilities, so at equal specificity a raw `text-sm` in a primitive's base
 * classes outranks a consumer's `type-body-small` regardless of which was
 * written last.
 *
 * The class group gives two guarantees:
 *
 * - two `type-*` on one element collapse to the last one written, so a
 *   consumer's override always beats a primitive's default;
 * - a `type-*` written after a raw `text-*` / `font-*` / `leading-*` /
 *   `tracking-*` drops it, so a consumer needs no `!` to beat a primitive that
 *   is still raw.
 *
 * The conflict is deliberately one directional. A raw class written AFTER a
 * `type-*` survives, so `type-mono-small tracking-wider` and
 * `type-label-caption font-semibold` tweak one axis of a ramp entry instead of
 * replacing it wholesale.
 */
const twMerge = extendTailwindMerge<'starter-type'>({
  extend: {
    classGroups: {
      'starter-type': [{ type: [...STARTER_TYPE_UTILITIES] }],
    },
    conflictingClassGroups: {
      'starter-type': ['font-size', 'font-weight', 'font-family', 'leading', 'tracking'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
