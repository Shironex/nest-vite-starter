import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import UpdatesSection from './UpdatesSection';

const state = vi.hoisted(() => ({
  appVersion: '1.0.0' as string | null,
}));

vi.mock('./UpdatesSection.hooks', () => ({
  useUpdatesSection: () => ({
    status: 'idle' as const,
    appVersion: state.appVersion,
    updateVersionLabel: '',
    channel: 'stable' as const,
    handleCheckForUpdates: vi.fn(),
    handleDownloadUpdate: vi.fn(),
    handleChannelChange: vi.fn(),
    handleInstallUpdate: vi.fn(),
  }),
}));

describe('UpdatesSection', () => {
  it('renders the card title', () => {
    state.appVersion = '1.0.0';
    render(<UpdatesSection />);
    expect(screen.getByText('Updates')).toBeInTheDocument();
  });

  it('renders the current version label', () => {
    state.appVersion = '1.0.0';
    render(<UpdatesSection />);
    expect(screen.getByText('Current version')).toBeInTheDocument();
    expect(screen.getByText('v1.0.0')).toBeInTheDocument();
  });

  it('renders a skeleton while the version is loading', () => {
    state.appVersion = null;
    render(<UpdatesSection />);
    expect(screen.queryByText(/^v/)).not.toBeInTheDocument();
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });

  it('renders Unknown when the version could not be read', () => {
    state.appVersion = 'Unknown';
    render(<UpdatesSection />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('renders the check for updates button', () => {
    state.appVersion = '1.0.0';
    render(<UpdatesSection />);
    expect(screen.getByRole('button', { name: /check for updates/i })).toBeInTheDocument();
  });
});
