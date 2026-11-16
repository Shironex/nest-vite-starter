import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { Button } from './button';
import {
  DetailDrawer,
  DetailDrawerContent,
  DetailDrawerHeader,
  DetailDrawerSection,
  DetailDrawerTitle,
  DetailDrawerTrigger,
} from './detail-drawer';
import {
  DoubleSheet,
  DoubleSheetBody,
  DoubleSheetClose,
  DoubleSheetClosePrimitive,
  DoubleSheetContent,
  DoubleSheetFooter,
  DoubleSheetHeader,
  DoubleSheetSection,
  DoubleSheetTitle,
  DoubleSheetTrigger,
} from './double-sheet';

function hostOf(slot: string): HTMLElement {
  const content = document.querySelector(`[data-slot="${slot}"]`);
  const host = content?.parentElement;
  if (!host) throw new Error(`no dock host for ${slot}`);
  return host;
}

function scrollLockStyleCount(): number {
  return Array.from(document.head.querySelectorAll('style')).filter((style) =>
    style.textContent?.includes('overflow: hidden'),
  ).length;
}

function ProjectFlow({ onSheetOpenChange }: { onSheetOpenChange?: (open: boolean) => void }) {
  return (
    <DetailDrawer>
      <DetailDrawerTrigger asChild>
        <Button>Open project card</Button>
      </DetailDrawerTrigger>
      <DetailDrawerContent description="Project card">
        <DetailDrawerHeader>
          <DetailDrawerTitle>Project details</DetailDrawerTitle>
        </DetailDrawerHeader>
        <DetailDrawerSection
          title="Contracts"
          action={
            <DoubleSheet {...(onSheetOpenChange ? { onOpenChange: onSheetOpenChange } : {})}>
              <DoubleSheetTrigger asChild>
                <Button size="sm">Add contract</Button>
              </DoubleSheetTrigger>
              <DoubleSheetContent description="New contract form">
                <DoubleSheetHeader>
                  <DoubleSheetClose label="Close form" />
                  <DoubleSheetTitle>Add contract</DoubleSheetTitle>
                </DoubleSheetHeader>
                <DoubleSheetBody>
                  <DoubleSheetSection title="General">
                    <input aria-label="Start date" />
                  </DoubleSheetSection>
                </DoubleSheetBody>
                <DoubleSheetFooter>
                  <DoubleSheetClosePrimitive asChild>
                    <Button variant="outline">Cancel</Button>
                  </DoubleSheetClosePrimitive>
                  <Button>Save</Button>
                </DoubleSheetFooter>
              </DoubleSheetContent>
            </DoubleSheet>
          }
        >
          <p>Service contract</p>
        </DetailDrawerSection>
      </DetailDrawerContent>
    </DetailDrawer>
  );
}

/**
 * Returns the in-drawer trigger. Once the sheet is open the drawer is
 * `aria-hidden`, so anything inside it is no longer reachable by role query.
 */
async function openDrawerAndSheet(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: 'Open project card' }));
  await screen.findByText('Project details');
  const sheetTrigger = screen.getByRole('button', { name: 'Add contract' });
  fireEvent.click(sheetTrigger);
  await screen.findByText('Add contract', { selector: '[data-slot="double-sheet-title"]' });
  return sheetTrigger;
}

describe('DoubleSheet beside DetailDrawer', () => {
  it('docks the sheet to the left of the drawer inside one dock', async () => {
    render(<ProjectFlow />);
    await openDrawerAndSheet();

    const drawerHost = hostOf('detail-drawer-content');
    const sheetHost = hostOf('double-sheet-content');
    const dock = document.querySelector('[data-slot="overlay-dock"]');

    expect(drawerHost.parentElement).toBe(dock);
    expect(sheetHost.parentElement).toBe(dock);
    expect(Number(sheetHost.style.order)).toBeLessThan(Number(drawerHost.style.order));
  });

  it('tints exactly one scrim while both panels are open', async () => {
    render(<ProjectFlow />);
    await openDrawerAndSheet();

    const drawerOverlay = document.querySelector('[data-slot="detail-drawer-overlay"]');
    const sheetOverlay = document.querySelector('[data-slot="double-sheet-overlay"]');

    expect(drawerOverlay?.className).toContain('bg-black/45');
    expect(sheetOverlay?.className).toContain('bg-transparent');
    expect(sheetOverlay?.className).not.toContain('bg-black/45');
  });

  it('does not double apply the scroll lock', async () => {
    render(<ProjectFlow />);
    fireEvent.click(screen.getByRole('button', { name: 'Open project card' }));
    await screen.findByText('Project details');

    const withDrawerOnly = scrollLockStyleCount();
    expect(withDrawerOnly).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Add contract' }));
    await screen.findByText('Add contract', { selector: '[data-slot="double-sheet-title"]' });

    expect(scrollLockStyleCount()).toBe(withDrawerOnly);
  });

  it('hides the drawer from assistive tech while the sheet is on top', async () => {
    render(<ProjectFlow />);
    await openDrawerAndSheet();

    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toHaveAccessibleName('Add contract');
    expect(hostOf('detail-drawer-content')).toHaveAttribute('aria-hidden', 'true');
  });

  it('closes only the sheet on Escape and puts focus back inside the drawer', async () => {
    const onSheetOpenChange = vi.fn();
    render(<ProjectFlow onSheetOpenChange={onSheetOpenChange} />);
    const sheetTrigger = await openDrawerAndSheet();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(document.querySelector('[data-slot="double-sheet-content"]')).toBeNull();
    });
    expect(onSheetOpenChange).toHaveBeenLastCalledWith(false);
    expect(document.querySelector('[data-slot="detail-drawer-content"]')).not.toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(sheetTrigger);
    });
    expect(hostOf('detail-drawer-content')).not.toHaveAttribute('aria-hidden');
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Project details');
  });

  it('traps focus inside whichever panel is on top', async () => {
    render(<ProjectFlow />);
    fireEvent.click(screen.getByRole('button', { name: 'Open project card' }));
    await screen.findByText('Project details');

    const drawerContent = document.querySelector('[data-slot="detail-drawer-content"]');
    await waitFor(() => {
      expect(drawerContent?.contains(document.activeElement)).toBe(true);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add contract' }));
    await screen.findByText('Add contract', { selector: '[data-slot="double-sheet-title"]' });

    const sheetContent = document.querySelector('[data-slot="double-sheet-content"]');
    await waitFor(() => {
      expect(sheetContent?.contains(document.activeElement)).toBe(true);
    });
  });

  it('drops the slide animation under prefers-reduced-motion', async () => {
    render(<ProjectFlow />);
    await openDrawerAndSheet();

    for (const slot of ['detail-drawer-content', 'double-sheet-content']) {
      expect(document.querySelector(`[data-slot="${slot}"]`)?.className).toContain(
        'motion-reduce:animate-none!',
      );
    }
  });

  it('closes the drawer on the second Escape and restores the page trigger', async () => {
    render(<ProjectFlow />);
    const drawerTrigger = screen.getByRole('button', { name: 'Open project card' });
    await openDrawerAndSheet();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(document.querySelector('[data-slot="double-sheet-content"]')).toBeNull();
    });

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(document.querySelector('[data-slot="detail-drawer-content"]')).toBeNull();
    });

    await waitFor(() => {
      expect(document.activeElement).toBe(drawerTrigger);
    });
    await waitFor(() => {
      expect(document.querySelector('[data-slot="overlay-dock"]')).toBeNull();
    });
  });

  it('releases the scroll lock only once both panels have closed', async () => {
    render(<ProjectFlow />);
    await openDrawerAndSheet();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(document.querySelector('[data-slot="double-sheet-content"]')).toBeNull();
    });
    expect(scrollLockStyleCount()).toBeGreaterThan(0);

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(document.querySelector('[data-slot="detail-drawer-content"]')).toBeNull();
    });
    await waitFor(() => {
      expect(scrollLockStyleCount()).toBe(0);
    });
  });

  it('closes the sheet from the footer cancel control', async () => {
    render(<ProjectFlow />);
    await openDrawerAndSheet();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(document.querySelector('[data-slot="double-sheet-content"]')).toBeNull();
    });
    expect(document.querySelector('[data-slot="detail-drawer-content"]')).not.toBeNull();
  });

  it('becomes the right-most panel when opened without a drawer', async () => {
    render(
      <DoubleSheet>
        <DoubleSheetTrigger asChild>
          <Button>Add project</Button>
        </DoubleSheetTrigger>
        <DoubleSheetContent description="New project form">
          <DoubleSheetHeader>
            <DoubleSheetTitle>Add project</DoubleSheetTitle>
          </DoubleSheetHeader>
          <DoubleSheetBody>
            <input aria-label="First name" />
          </DoubleSheetBody>
        </DoubleSheetContent>
      </DoubleSheet>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add project' }));
    await screen.findByRole('dialog');

    expect(hostOf('double-sheet-content').style.order).toBe('0');
    expect(document.querySelector('[data-slot="double-sheet-overlay"]')?.className).toContain(
      'bg-black/45',
    );
  });
});
