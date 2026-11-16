import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DataExportSection from './DataExportSection';
import type { IDataExportSectionView } from './DataExportSection.types';

const { view } = vi.hoisted(() => ({
  view: { current: null as IDataExportSectionView | null },
}));

// The download flow (fetch, file save, error translation) lives in the hook
// and is proven in DataExportSection.hooks.test.tsx; this file owns what the
// panel draws for a given view.
vi.mock('./DataExportSection.hooks', () => ({
  useDataExportSection: () => view.current,
}));

const baseView = (overrides: Partial<IDataExportSectionView> = {}): IDataExportSectionView => ({
  onDownload: vi.fn(),
  isPending: false,
  errorMessage: undefined,
  ...overrides,
});

describe('DataExportSection', () => {
  it('describes what the export contains before offering the download', () => {
    view.current = baseView();
    render(<DataExportSection />);

    expect(screen.getByText('Account data export')).toBeInTheDocument();
    expect(screen.getByText(/The export contains your account profile data/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download my data' })).toBeEnabled();
  });

  it('fires the download action on click', () => {
    const onDownload = vi.fn();
    view.current = baseView({ onDownload });
    render(<DataExportSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Download my data' }));

    expect(onDownload).toHaveBeenCalledOnce();
  });

  it('disables the button while the export is being prepared', () => {
    view.current = baseView({ isPending: true });
    render(<DataExportSection />);

    expect(screen.getByRole('button', { name: 'Download my data' })).toBeDisabled();
  });

  it('renders the error line as an alert when the export fails', () => {
    view.current = baseView({ errorMessage: 'Could not prepare the data export' });
    render(<DataExportSection />);

    expect(screen.getByRole('alert')).toHaveTextContent('Could not prepare the data export');
  });
});
