import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ListSearchField from './ListSearchField';

describe('ListSearchField', () => {
  it('is reachable by its accessible name, with no visible label in the toolbar', () => {
    render(
      <ListSearchField
        value=""
        onValueChange={() => undefined}
        label="Search projects"
        placeholder="Search projects..."
      />,
    );

    expect(screen.getByLabelText('Search projects')).toHaveAttribute('type', 'search');
  });

  it('hands the caller a plain string rather than the event', () => {
    const onValueChange = vi.fn();
    render(
      <ListSearchField
        value=""
        onValueChange={onValueChange}
        label="Search projects"
        placeholder="Search projects..."
      />,
    );

    fireEvent.change(screen.getByLabelText('Search projects'), {
      target: { value: 'Kowalska' },
    });

    expect(onValueChange).toHaveBeenCalledWith('Kowalska');
  });
});
