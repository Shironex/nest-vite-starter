import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { Pagination } from './pagination';

const labels = {
  label: 'People list pagination',
  previous: 'Previous',
  next: 'Next',
  summary: 'Showing 1-25 of 312',
};

describe('Pagination', () => {
  it('renders no page numbers, because a keyset list cannot reach page 7', () => {
    render(
      <Pagination hasPrevious hasNext onPrevious={vi.fn()} onNext={vi.fn()} labels={labels} />,
    );

    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });

  it('states the range AND the total beside the two controls', () => {
    // Losing the numbered buttons did not lose the count. The lists that can
    // afford a total still say it; the summary is a caller-formatted string, so
    // the primitive never has to know which ones those are.
    render(
      <Pagination
        hasPrevious={false}
        hasNext
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        labels={labels}
      />,
    );

    expect(screen.getByText('Showing 1-25 of 312')).toBeInTheDocument();
  });

  it('steps forward and back', () => {
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    render(
      <Pagination hasPrevious hasNext onPrevious={onPrevious} onNext={onNext} labels={labels} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));

    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrevious).toHaveBeenCalledTimes(1);
  });

  // The two ends are where an off-by-one turns into a request for a page that
  // does not exist.
  it('disables the ends the cursor has reached', () => {
    render(
      <Pagination
        hasPrevious={false}
        hasNext={false}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        labels={labels}
      />,
    );

    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('disables every control while a page is in flight', () => {
    render(
      <Pagination
        hasPrevious
        hasNext
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        isBusy
        labels={labels}
      />,
    );

    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
  });

  it('keeps its own props off the nav element', () => {
    // Props reaching the DOM is how React starts warning about unknown
    // attributes on every render.
    render(
      <Pagination hasPrevious hasNext onPrevious={vi.fn()} onNext={vi.fn()} labels={labels} />,
    );

    const nav = screen.getByRole('navigation', { name: 'People list pagination' });
    expect(nav).not.toHaveAttribute('hasNext');
    expect(nav).not.toHaveAttribute('labels');
  });
});
