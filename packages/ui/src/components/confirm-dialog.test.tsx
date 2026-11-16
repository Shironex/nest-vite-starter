import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { OVERLAY_SCRIM_CLASS } from '../lib/overlay';
import { Button } from './button';
import { ConfirmDialog } from './confirm-dialog';
import {
  DetailDrawer,
  DetailDrawerContent,
  DetailDrawerHeader,
  DetailDrawerTitle,
  DetailDrawerTrigger,
} from './detail-drawer';

const COPY = {
  title: 'Delete this project?',
  description:
    'This removes the project Northwind Trading Ltd together with its related data. This action cannot be undone.',
  confirmLabel: 'Delete',
  cancelLabel: 'Cancel',
};

describe('ConfirmDialog', () => {
  it('is a modal dialog labeled and described by its copy', async () => {
    render(<ConfirmDialog {...COPY} defaultOpen trigger={<Button>Delete project</Button>} />);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName(COPY.title);
    expect(dialog).toHaveAccessibleDescription(COPY.description);
  });

  it('offers no close affordance beyond cancel and confirm', async () => {
    render(<ConfirmDialog {...COPY} defaultOpen />);
    await screen.findByRole('dialog');

    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Cancel', 'Delete']);
  });

  it('puts initial focus on the non destructive choice', async () => {
    render(<ConfirmDialog {...COPY} defaultOpen />);
    await screen.findByRole('dialog');

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    });
  });

  it('runs onConfirm and leaves closing to the caller', async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(<ConfirmDialog {...COPY} open onOpenChange={onOpenChange} onConfirm={onConfirm} />);
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('disables both choices while an async confirm is in flight', async () => {
    let resolveConfirm: () => void = () => undefined;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        }),
    );
    render(<ConfirmDialog {...COPY} open onConfirm={onConfirm} />);
    await screen.findByRole('dialog');

    const confirm = screen.getByRole('button', { name: 'Delete' });
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(confirm).toBeDisabled();
    });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);

    resolveConfirm();
    await waitFor(() => {
      expect(confirm).not.toBeDisabled();
    });
  });

  it('honors a caller owned loading flag', async () => {
    render(<ConfirmDialog {...COPY} open loading />);
    await screen.findByRole('dialog');

    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('closes on cancel', async () => {
    const onOpenChange = vi.fn();
    render(<ConfirmDialog {...COPY} defaultOpen onOpenChange={onOpenChange} />);
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('closes only itself when confirming from inside an open drawer', async () => {
    render(
      <DetailDrawer defaultOpen>
        <DetailDrawerTrigger asChild>
          <Button>Open project card</Button>
        </DetailDrawerTrigger>
        <DetailDrawerContent description="Project card">
          <DetailDrawerHeader>
            <DetailDrawerTitle>Project details</DetailDrawerTitle>
          </DetailDrawerHeader>
          <ConfirmDialog {...COPY} trigger={<Button>Delete project</Button>} />
        </DetailDrawerContent>
      </DetailDrawer>,
    );

    const confirmTrigger = await screen.findByRole('button', { name: 'Delete project' });
    fireEvent.click(confirmTrigger);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toHaveAccessibleName(COPY.title);
    });

    // The drawer already dims the page, so the modal must not scrim on top of it.
    expect(document.querySelector('[data-slot="dialog-overlay"]')?.className).toContain(
      'bg-transparent',
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(document.querySelector('[data-slot="confirm-dialog-content"]')).toBeNull();
    });
    expect(document.querySelector('[data-slot="detail-drawer-content"]')).not.toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(confirmTrigger);
    });
  });

  it('keeps its own scrim when nothing else is dimming the page', async () => {
    render(<ConfirmDialog {...COPY} defaultOpen />);
    await screen.findByRole('dialog');

    expect(document.querySelector('[data-slot="dialog-overlay"]')?.className).toContain(
      OVERLAY_SCRIM_CLASS,
    );
  });
});
