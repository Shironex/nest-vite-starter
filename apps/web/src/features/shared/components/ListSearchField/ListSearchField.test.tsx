import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ListSearchField from './ListSearchField';

describe('ListSearchField', () => {
  it('is reachable by its accessible name, with no visible label in the toolbar', () => {
    render(
      <ListSearchField
        value=""
        onValueChange={() => undefined}
        label="Search workspaces"
        placeholder="Search workspaces..."
      />,
    );

    expect(screen.getByLabelText('Search workspaces')).toHaveAttribute('type', 'search');
  });

  it('hands the caller a plain string rather than the event', () => {
    const onValueChange = vi.fn();
    render(
      <ListSearchField
        value=""
        onValueChange={onValueChange}
        label="Search workspaces"
        placeholder="Search workspaces..."
      />,
    );

    fireEvent.change(screen.getByLabelText('Search workspaces'), {
      target: { value: 'Kowalska' },
    });

    expect(onValueChange).toHaveBeenCalledWith('Kowalska');
  });
});
