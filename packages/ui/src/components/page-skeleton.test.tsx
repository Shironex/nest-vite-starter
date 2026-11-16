import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PageSkeleton } from './page-skeleton';

describe('PageSkeleton', () => {
  // The wait has to be announced once, and the region has to read as in
  // flight: a screen reader given an unnamed pile of empty divs is told
  // nothing at all about why the page is not there yet.
  it('announces the wait with the caller own copy', () => {
    render(<PageSkeleton label="Loading..." />);

    const region = screen.getByRole('status');
    expect(region).toHaveAccessibleName('Loading...');
    expect(region).toHaveAttribute('aria-busy', 'true');
  });

  it('holds a different silhouette per variant', () => {
    const { container: list } = render(<PageSkeleton variant="list" label="x" />);
    const { container: cards } = render(<PageSkeleton variant="cards" label="x" />);

    expect(list.innerHTML).not.toEqual(cards.innerHTML);
  });

  it('falls back to the list silhouette, which most routes are', () => {
    const { container: implicit } = render(<PageSkeleton label="x" />);
    const { container: explicit } = render(<PageSkeleton variant="list" label="x" />);

    expect(implicit.innerHTML).toEqual(explicit.innerHTML);
  });
});
