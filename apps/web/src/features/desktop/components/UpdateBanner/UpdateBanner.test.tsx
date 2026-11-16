import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import UpdateBanner from './UpdateBanner';

const state = vi.hoisted(() => ({
  status: 'downloaded' as 'available' | 'downloading' | 'downloaded' | 'error',
  onDownload: vi.fn(),
}));

vi.mock('./UpdateBanner.hooks', () => ({
  useUpdateBanner: () => ({
    status: state.status,
    versionLabel: ' v1.2.3',
    progressLabel: '',
    errorLabel: 'Unknown error',
    onDownload: state.onDownload,
    onRestart: vi.fn(),
    onDismiss: vi.fn(),
  }),
}));

describe('UpdateBanner', () => {
  it('renders the restart button when update is downloaded', () => {
    state.status = 'downloaded';
    render(<UpdateBanner />);
    expect(screen.getByText('Restart now')).toBeInTheDocument();
  });

  it('offers a manual download action when an update is available', () => {
    state.status = 'available';
    state.onDownload.mockClear();
    render(<UpdateBanner />);
    const download = screen.getByRole('button', { name: /^download$/i });
    fireEvent.click(download);
    expect(state.onDownload).toHaveBeenCalledTimes(1);
    state.status = 'downloaded';
  });

  it('renders the version label in the status text', () => {
    render(<UpdateBanner />);
    // The span reads "Update v1.2.3 ready · [button]"; check the version string appears
    expect(screen.getByText(/v1\.2\.3/)).toBeInTheDocument();
  });

  it('renders the dismiss button', () => {
    render(<UpdateBanner />);
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });
});
