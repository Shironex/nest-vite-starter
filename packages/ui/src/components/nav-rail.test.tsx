import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { NavRailBrand, NavRailIdentity, navRailItemClass } from './nav-rail';

/*
 * These pin the two ways a shared rail goes wrong silently. Neither failure
 * throws, neither fails a type check, and both are invisible in a unit test
 * that only asserts a row renders: one paints every row selected, the other
 * paints none of them.
 */
describe('navRailItemClass', () => {
  // The sidebar primitive renders `data-active={isActive}`, and React
  // serializes a false into the literal string "false" while leaving the
  // ATTRIBUTE present. A `data-active:` presence variant therefore matches
  // every row in the rail, so selection must be matched on the VALUE.
  it('selects on the attribute value, never on its presence', () => {
    const classes = navRailItemClass();

    expect(classes).toContain('data-[active=true]:bg-brand-50');
    expect(classes).not.toMatch(/(^|\s)data-active:/);
  });

  // A router `Link` sets `aria-current="page"` rather than `data-active`, so
  // both idioms have to reach the same fill.
  it('selects on aria-current too, so a bare link lights up as well', () => {
    expect(navRailItemClass()).toContain('aria-[current=page]:bg-brand-50');
  });

  // `brand-subtle` is the shape of token name that looks right and does not
  // exist: Tailwind emits nothing for an unknown utility, so the selected row
  // gets no fill at all and the failure is completely silent.
  it('names only tokens the palette actually defines', () => {
    const classes = navRailItemClass('relaxed');

    expect(classes).not.toContain('brand-subtle');
    expect(classes).not.toContain('sidebar-accent');
  });

  it('changes spacing with density and nothing else', () => {
    const comfortable = navRailItemClass('comfortable');
    const relaxed = navRailItemClass('relaxed');

    expect(comfortable).toContain('py-2');
    expect(relaxed).toContain('py-2.5');
    expect(relaxed).toContain('data-[active=true]:bg-brand-50');
  });
});

describe('NavRailBrand', () => {
  it('draws the mark decoratively so the wordmark is the only name read', () => {
    render(<NavRailBrand mark="S" wordmark="Nest Vite Starter" />);

    expect(screen.getByText('Nest Vite Starter')).toBeInTheDocument();
    expect(screen.getByText('S')).toHaveAttribute('aria-hidden', 'true');
  });

  it('carries a caption for a shell that is one surface of several', () => {
    render(<NavRailBrand mark="S" wordmark="Nest Vite Starter" caption="Admin console" />);

    expect(screen.getByText('Admin console')).toBeInTheDocument();
  });
});

describe('NavRailIdentity', () => {
  it('reads out the person, not the avatar glyph', () => {
    render(<NavRailIdentity initial="AN" name="Avery Nolan" detail="avery@example.com" />);

    expect(screen.getByText('Avery Nolan')).toBeInTheDocument();
    expect(screen.getByText('avery@example.com')).toBeInTheDocument();
    expect(screen.getByText('AN')).toHaveAttribute('aria-hidden', 'true');
  });

  it('omits the detail line rather than rendering an empty one', () => {
    const { container } = render(<NavRailIdentity initial="AN" name="Avery Nolan" />);

    expect(container.querySelector('.type-label-caption')).toBeNull();
  });
});
