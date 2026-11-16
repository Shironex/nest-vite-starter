import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ConnectedAccountsSection from './ConnectedAccountsSection';
import type {
  IConnectedAccountRow,
  IConnectedAccountsSectionView,
} from './ConnectedAccountsSection.types';

const { view } = vi.hoisted(() => ({
  view: { current: null as IConnectedAccountsSectionView | null },
}));

// Queries, the sudo state machine and the search-param handling live in the
// hook and are proven in ConnectedAccountsSection.hooks.test.tsx; this file
// owns what the panel draws for a given view.
vi.mock('./ConnectedAccountsSection.hooks', () => ({
  useConnectedAccountsSection: () => view.current,
}));

// The dialog has its own tests and pulls in trpc; a marker stands in for it.
vi.mock('../ConfirmPasswordDialog', () => ({
  ConfirmPasswordDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="confirm-password-dialog" /> : null,
}));

const googleRow = (id: string, email: string): IConnectedAccountRow => ({
  id,
  providerName: 'Google',
  email,
  linkedOn: 'Linked 07/01/2026',
  lastUsed: 'last used 08/01/2026',
  unlinkAccessibleLabel: `Unlink Google account (${email})`,
});

const baseView = (overrides: Partial<IConnectedAccountsSectionView>) =>
  ({
    state: 'ready' as const,
    rows: [],
    linkOptions: [],
    onLink: vi.fn(),
    onUnlink: vi.fn(),
    isUnlinkPending: false,
    unlinkingId: null,
    isDialogOpen: false,
    onDialogOpenChange: vi.fn(),
    onSudoConfirmed: vi.fn(),
    ...overrides,
  }) satisfies IConnectedAccountsSectionView;

describe('ConnectedAccountsSection', () => {
  it('renders a row per linked account, e-mails telling twin providers apart', () => {
    view.current = baseView({
      rows: [googleRow('acc-1', 'first@gmail.com'), googleRow('acc-2', 'second@gmail.com')],
    });
    render(<ConnectedAccountsSection />);

    expect(screen.getByText('Connected accounts')).toBeInTheDocument();
    expect(screen.getAllByText('Google')).toHaveLength(2);
    expect(screen.getByText('first@gmail.com')).toBeInTheDocument();
    expect(screen.getByText('second@gmail.com')).toBeInTheDocument();
    expect(screen.queryByText('You have no connected accounts yet.')).not.toBeInTheDocument();
  });

  it('unlinks the row whose button was pressed, by row id', () => {
    const onUnlink = vi.fn();
    view.current = baseView({
      rows: [googleRow('acc-1', 'first@gmail.com'), googleRow('acc-2', 'second@gmail.com')],
      onUnlink,
    });
    render(<ConnectedAccountsSection />);

    // The accessible name carries the e-mail, so the SECOND Google row is
    // addressable without ambiguity, exactly like the unlink call itself.
    fireEvent.click(
      screen.getByRole('button', { name: 'Unlink Google account (second@gmail.com)' }),
    );

    expect(onUnlink).toHaveBeenCalledWith('acc-2');
  });

  it('shows the empty state alongside the link actions', () => {
    const onLink = vi.fn();
    view.current = baseView({
      state: 'empty',
      linkOptions: [{ key: 'google', label: 'Link Google account' }],
      onLink,
    });
    render(<ConnectedAccountsSection />);

    expect(screen.getByText('You have no connected accounts yet.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Link Google account' }));
    expect(onLink).toHaveBeenCalledWith('google');
  });

  it('holds every unlink action while one is in flight', () => {
    view.current = baseView({
      rows: [googleRow('acc-1', 'first@gmail.com'), googleRow('acc-2', 'second@gmail.com')],
      isUnlinkPending: true,
      unlinkingId: 'acc-1',
    });
    render(<ConnectedAccountsSection />);

    expect(
      screen.getByRole('button', { name: 'Unlink Google account (first@gmail.com)' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Unlink Google account (second@gmail.com)' }),
    ).toBeDisabled();
  });

  it('shows the loading line before the first answer', () => {
    view.current = baseView({ state: 'loading' });
    render(<ConnectedAccountsSection />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByText('You have no connected accounts yet.')).not.toBeInTheDocument();
  });

  it('shows the load-failure line instead of an empty state on error', () => {
    view.current = baseView({ state: 'error' });
    render(<ConnectedAccountsSection />);

    expect(screen.getByText('Could not load your connected accounts.')).toBeInTheDocument();
    expect(screen.queryByText('You have no connected accounts yet.')).not.toBeInTheDocument();
  });

  it('mounts the sudo dialog when the view opens it', () => {
    view.current = baseView({ isDialogOpen: true });
    render(<ConnectedAccountsSection />);

    expect(screen.getByTestId('confirm-password-dialog')).toBeInTheDocument();
  });
});
