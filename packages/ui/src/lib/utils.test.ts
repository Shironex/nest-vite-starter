import { describe, expect, it } from 'vitest';

import { cn } from './utils';

/*
 * These lock in the type ramp's merge semantics. Tailwind emits custom
 * `@utility` rules before the core `text-*` / `font-*` utilities, so without the
 * class group registered in `cn` a primitive's raw `text-sm` silently outranks a
 * consumer's `type-body-small`, and two `type-*` utilities on one element
 * resolve by stylesheet order rather than by the order they were written.
 */
describe('cn', () => {
  it('drops a raw text class when a type utility follows it', () => {
    expect(cn('text-sm text-muted-foreground', 'type-body-small')).toBe(
      'text-muted-foreground type-body-small',
    );
  });

  it('drops a raw font weight when a type utility follows it', () => {
    expect(cn('font-medium text-muted-foreground', 'type-label-overline text-text-muted')).toBe(
      'type-label-overline text-text-muted',
    );
  });

  it('keeps only the last type utility so a consumer override always wins', () => {
    expect(cn('type-heading-h3', 'type-body-medium')).toBe('type-body-medium');
    expect(cn('type-body-medium', 'type-heading-h3')).toBe('type-heading-h3');
  });

  it('leaves a raw class written after a type utility alone, so one axis can be tweaked', () => {
    expect(cn('type-mono-small', 'tracking-wider')).toBe('type-mono-small tracking-wider');
    expect(cn('type-label-caption', 'font-semibold')).toBe('type-label-caption font-semibold');
  });

  it('scopes the conflict per modifier', () => {
    expect(cn('text-sm group-data-[size=sm]/avatar:text-xs', 'type-label-caption')).toBe(
      'group-data-[size=sm]/avatar:text-xs type-label-caption',
    );
  });

  it('still merges stock Tailwind class groups', () => {
    expect(cn('px-2 px-4')).toBe('px-4');
  });
});
