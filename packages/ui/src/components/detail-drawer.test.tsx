import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { Button } from './button';
import {
  DetailDrawer,
  DetailDrawerCard,
  DetailDrawerClose,
  DetailDrawerContent,
  DetailDrawerField,
  DetailDrawerFields,
  DetailDrawerHeader,
  DetailDrawerSection,
  DetailDrawerTab,
  DetailDrawerTabPanel,
  DetailDrawerTabs,
  DetailDrawerTabsList,
  DetailDrawerTitle,
  DetailDrawerTrigger,
} from './detail-drawer';

function WorkspaceDrawer({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  return (
    <DetailDrawer {...(onOpenChange ? { onOpenChange } : {})}>
      <DetailDrawerTrigger asChild>
        <Button>Open workspace card</Button>
      </DetailDrawerTrigger>
      <DetailDrawerContent description="Workspace card">
        <DetailDrawerHeader>
          <DetailDrawerClose label="Close" />
          <DetailDrawerTitle>Workspace details</DetailDrawerTitle>
        </DetailDrawerHeader>
        <DetailDrawerTabs defaultValue="personal">
          <DetailDrawerTabsList aria-label="Record sections">
            <DetailDrawerTab value="personal">Personal details</DetailDrawerTab>
            <DetailDrawerTab value="contracts">Contracts</DetailDrawerTab>
            <DetailDrawerTab value="invoices">Invoices</DetailDrawerTab>
          </DetailDrawerTabsList>
          <DetailDrawerTabPanel value="personal">
            <DetailDrawerSection title="Personal details" action={<Button size="sm">Edit</Button>}>
              <DetailDrawerCard>
                <DetailDrawerFields>
                  <DetailDrawerField label="Full name">Jordan Rivera</DetailDrawerField>
                </DetailDrawerFields>
              </DetailDrawerCard>
            </DetailDrawerSection>
          </DetailDrawerTabPanel>
          <DetailDrawerTabPanel value="contracts">Service contract</DetailDrawerTabPanel>
          <DetailDrawerTabPanel value="invoices">No invoices</DetailDrawerTabPanel>
        </DetailDrawerTabs>
      </DetailDrawerContent>
    </DetailDrawer>
  );
}

describe('DetailDrawer', () => {
  it('exposes a modal dialog labeled by its title', async () => {
    render(<WorkspaceDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace card' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Workspace details');
    expect(dialog).toHaveAccessibleDescription('Workspace card');
  });

  it('mounts into the shared overlay dock rather than straight into the body', async () => {
    render(<WorkspaceDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace card' }));
    await screen.findByRole('dialog');

    const dock = document.querySelector('[data-slot="overlay-dock"]');
    expect(dock).not.toBeNull();
    expect(dock?.contains(document.querySelector('[data-slot="detail-drawer-content"]'))).toBe(
      true,
    );
  });

  it('removes the dock once the last panel unmounts', async () => {
    const { unmount } = render(<WorkspaceDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace card' }));
    await screen.findByRole('dialog');

    unmount();
    await waitFor(() => {
      expect(document.querySelector('[data-slot="overlay-dock"]')).toBeNull();
    });
  });

  it('follows the WAI-ARIA tabs pattern with arrow key navigation', async () => {
    render(<WorkspaceDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace card' }));
    await screen.findByRole('dialog');

    const tablist = screen.getByRole('tablist', { name: 'Record sections' });
    expect(tablist).toBeInTheDocument();

    const personal = screen.getByRole('tab', { name: 'Personal details' });
    expect(personal).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Jordan Rivera');

    personal.focus();
    fireEvent.keyDown(personal, { key: 'ArrowRight' });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Contracts' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Service contract');
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const onOpenChange = vi.fn();
    render(<WorkspaceDrawer onOpenChange={onOpenChange} />);

    const trigger = screen.getByRole('button', { name: 'Open workspace card' });
    fireEvent.click(trigger);
    await screen.findByRole('dialog');

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it('closes from the header close control', async () => {
    render(<WorkspaceDrawer />);
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace card' }));
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
