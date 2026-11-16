import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ListFilterPopover from './ListFilterPopover';

const labels = {
  trigger: 'Filters',
  heading: 'Narrow the list',
  clear: 'Clear',
  activeCount: '2 active filters',
};

describe('ListFilterPopover', () => {
  it('keeps the filters closed until the trigger is pressed', async () => {
    render(
      <ListFilterPopover labels={labels} activeCount={0}>
        <p>Stanowisko</p>
      </ListFilterPopover>,
    );

    expect(screen.queryByText('Stanowisko')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: new RegExp(labels.trigger) }));

    await waitFor(() => expect(screen.getByText('Stanowisko')).toBeInTheDocument());
  });

  it('badges the active count, so a filtered list never looks unfiltered', () => {
    render(
      <ListFilterPopover labels={labels} activeCount={2}>
        <p>Stanowisko</p>
      </ListFilterPopover>,
    );

    expect(screen.getByLabelText(labels.activeCount)).toHaveTextContent('2');
  });

  it('offers no reset while nothing is active', async () => {
    const onClear = vi.fn();
    render(
      <ListFilterPopover labels={labels} activeCount={0} onClear={onClear}>
        <p>Stanowisko</p>
      </ListFilterPopover>,
    );

    fireEvent.click(screen.getByRole('button', { name: new RegExp(labels.trigger) }));

    await waitFor(() => expect(screen.getByText('Stanowisko')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: labels.clear })).not.toBeInTheDocument();
  });

  it('closes on clear, so the unfiltered rows are actually visible', async () => {
    const onClear = vi.fn();
    render(
      <ListFilterPopover labels={labels} activeCount={2} onClear={onClear}>
        <p>Stanowisko</p>
      </ListFilterPopover>,
    );

    fireEvent.click(screen.getByRole('button', { name: new RegExp(labels.trigger) }));
    const clear = await screen.findByRole('button', { name: labels.clear });
    fireEvent.click(clear);

    expect(onClear).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByText('Stanowisko')).not.toBeInTheDocument());
  });
});
