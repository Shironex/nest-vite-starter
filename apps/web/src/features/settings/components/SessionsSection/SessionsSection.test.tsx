import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SessionsSection from './SessionsSection';
import type { ISessionRow, ISessionsSectionView } from './SessionsSection.types';

const { view } = vi.hoisted(() => ({
  view: { current: null as ISessionsSectionView | null },
}));

// Queries, mutations, and the user-agent parsing live in the hook and are
// proven in SessionsSection.hooks.test.tsx; this file owns what the panel
// draws for a given view.
vi.mock('./SessionsSection.hooks', () => ({
  useSessionsSection: () => view.current,
}));

const row = (id: string, overrides: Partial<ISessionRow> = {}): ISessionRow => ({
  id,
  deviceLabel: 'Chrome · Windows',
  ip: '203.0.113.7',
  signedIn: 'Signed in 08/01/2026',
  lastActive: 'Last active 08/04/2026',
  isCurrent: false,
  isMobile: false,
  revokeAccessibleLabel: `Sign out session: Chrome · Windows (${id})`,
  ...overrides,
});

const baseView = (overrides: Partial<ISessionsSectionView>) =>
  ({
    state: 'ready' as const,
    rows: [],
    onRevoke: vi.fn(),
    isRevokePending: false,
    revokingId: null,
    hasOtherSessions: false,
    onRevokeOthers: vi.fn(),
    isRevokeOthersPending: false,
    isConfirmOpen: false,
    onConfirmOpenChange: vi.fn(),
    ...overrides,
  }) satisfies ISessionsSectionView;

describe('SessionsSection', () => {
  it('renders a row per session with the device, ip, and date lines', () => {
    view.current = baseView({
      rows: [row('s-1'), row('s-2', { deviceLabel: 'Safari · macOS' })],
      hasOtherSessions: true,
    });
    render(<SessionsSection />);

    expect(screen.getByText('Active sessions')).toBeInTheDocument();
    expect(screen.getByText('Chrome · Windows')).toBeInTheDocument();
    expect(screen.getByText('Safari · macOS')).toBeInTheDocument();
    expect(screen.getAllByText('203.0.113.7')).toHaveLength(2);
  });

  it('badges the current device and gives it NO revoke button', () => {
    view.current = baseView({
      rows: [row('s-current', { isCurrent: true }), row('s-other')],
      hasOtherSessions: true,
    });
    render(<SessionsSection />);

    expect(screen.getByText('This device')).toBeInTheDocument();
    // One revoke button for two rows: the current device signs out via
    // logout, not via self-revocation.
    expect(screen.getAllByRole('button', { name: /^Sign out session:/u })).toHaveLength(1);
  });

  it('revokes the row whose button was pressed, by its opaque id', () => {
    const onRevoke = vi.fn();
    view.current = baseView({
      rows: [row('s-1'), row('s-2')],
      hasOtherSessions: true,
      onRevoke,
    });
    render(<SessionsSection />);

    // The accessible name carries the id-bearing label, so the SECOND row is
    // addressable without ambiguity, exactly like the revoke call itself.
    fireEvent.click(
      screen.getByRole('button', { name: 'Sign out session: Chrome · Windows (s-2)' }),
    );

    expect(onRevoke).toHaveBeenCalledWith('s-2');
  });

  it('hides the sign-out-others action when this device is the only session', () => {
    view.current = baseView({
      rows: [row('s-current', { isCurrent: true })],
      hasOtherSessions: false,
    });
    render(<SessionsSection />);

    expect(
      screen.queryByRole('button', { name: 'Sign out other sessions' }),
    ).not.toBeInTheDocument();
  });

  it('confirms sign-out-others through the dialog before firing', () => {
    const onRevokeOthers = vi.fn();
    view.current = baseView({
      rows: [row('s-current', { isCurrent: true }), row('s-other')],
      hasOtherSessions: true,
      isConfirmOpen: true,
      onRevokeOthers,
    });
    render(<SessionsSection />);

    expect(screen.getByText('Sign out other sessions?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out others' }));

    expect(onRevokeOthers).toHaveBeenCalledTimes(1);
  });

  it('shows the load-failure line instead of rows on error', () => {
    view.current = baseView({ state: 'error' });
    render(<SessionsSection />);

    expect(screen.getByText('Could not load the session list')).toBeInTheDocument();
  });
});
