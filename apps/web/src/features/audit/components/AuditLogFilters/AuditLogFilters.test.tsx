import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AuditLogFilters from './AuditLogFilters';
import type { IAuditLogFiltersProps, IAuditLogFiltersView } from './AuditLogFilters.types';

const handlers = vi.hoisted(() => ({
  onFromInput: vi.fn(),
  onToInput: vi.fn(),
  onActionValueChange: vi.fn(),
  activeFilters: 0,
}));

vi.mock('./AuditLogFilters.hooks', () => ({
  useAuditLogFilters: (): IAuditLogFiltersView => ({
    actorValue: null,
    actionValue: null,
    actorOptions: [{ value: 'u-1', label: 'Anna Keller' }],
    actionOptions: [
      { value: 'auth.login.failure', label: 'Failed sign-in', group: 'Sign-in and account' },
      { value: 'user.role.changed', label: 'Role changed', group: 'User accounts' },
    ],
    isActorsLoading: false,
    onActorValueChange: vi.fn(),
    onActionValueChange: handlers.onActionValueChange,
    onFromInput: handlers.onFromInput,
    onToInput: handlers.onToInput,
    labels: {
      trigger: 'Filters',
      heading: 'Narrow the list',
      activeCount: '1 active filter',
      actor: 'User',
      actorAll: 'All users',
      eventType: 'Event type',
      eventTypeAll: 'All events',
      search: 'Search',
      noMatch: 'No match',
      loading: 'Loading...',
      from: 'From',
      to: 'To',
      clear: 'Clear filters',
    },
  }),
}));

function makeProps(overrides: Partial<IAuditLogFiltersProps> = {}): IAuditLogFiltersProps {
  return {
    actorId: '',
    action: '',
    fromValue: '',
    toValue: '',
    activeFilters: handlers.activeFilters,
    onActorChange: vi.fn(),
    onActionChange: vi.fn(),
    onFromChange: vi.fn(),
    onToChange: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  };
}

const openPanel = async () => {
  fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
  await screen.findByText('Narrow the list');
};

describe('AuditLogFilters', () => {
  it('keeps four controls behind one button instead of across two rows', async () => {
    render(<AuditLogFilters {...makeProps()} />);

    expect(screen.queryByText('User')).not.toBeInTheDocument();

    await openPanel();

    expect(screen.getByText('User')).toBeInTheDocument();
    expect(screen.getByText('Event type')).toBeInTheDocument();
    expect(screen.getByLabelText('From')).toBeInTheDocument();
    expect(screen.getByLabelText('To')).toBeInTheDocument();
  });

  it('makes the 74 event types searchable rather than a scroll', async () => {
    render(<AuditLogFilters {...makeProps()} />);
    await openPanel();

    fireEvent.click(screen.getByRole('combobox', { name: 'Event type' }));

    const search = await screen.findByPlaceholderText('Search');
    fireEvent.change(search, { target: { value: 'Failed' } });

    await waitFor(() => expect(screen.getByText('Failed sign-in')).toBeInTheDocument());
    expect(screen.queryByText('Role changed')).not.toBeInTheDocument();
  });

  it('forwards date edits through the hook handlers', async () => {
    render(<AuditLogFilters {...makeProps()} />);
    await openPanel();

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-07-01' } });
    expect(handlers.onFromInput).toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-07-14' } });
    expect(handlers.onToInput).toHaveBeenCalled();
  });

  it('offers to clear only when something is narrowed', async () => {
    const { unmount } = render(<AuditLogFilters {...makeProps()} />);
    await openPanel();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
    unmount();

    const onClear = vi.fn();
    render(<AuditLogFilters {...makeProps({ activeFilters: 1, onClear })} />);
    await openPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});
