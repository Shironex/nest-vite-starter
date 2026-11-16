'use client';

import * as React from 'react';
import { XIcon } from 'lucide-react';

import { cn } from '@repo/ui/lib/utils';
import { useOverlayDockScrimActive } from '@repo/ui/lib/overlay';
import { Button } from '@repo/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui/dialog';

/**
 * Centered confirmation modal.
 *
 * In the design system a centered modal is reserved for confirmations.
 * Creating and editing records uses `DoubleSheet` docked beside `DetailDrawer`.
 * This component takes no `children` on purpose: there is no slot to grow a
 * form into, so it cannot quietly become a general purpose modal.
 */

export type ConfirmDialogTone = 'danger' | 'default';

export interface IConfirmDialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Question the user is answering, for example "Delete this project?". */
  title: React.ReactNode;
  /** What will happen, including anything that cannot be undone. */
  description: React.ReactNode;
  confirmLabel?: React.ReactNode;
  cancelLabel?: React.ReactNode;
  tone?: ConfirmDialogTone;
  /**
   * Runs when the user confirms. If it returns a promise the buttons stay
   * disabled until it settles. The dialog does not close itself and does not
   * surface failures; the caller owns both, usually through its mutation state.
   */
  onConfirm?: () => void | Promise<unknown>;
  /** Force the pending state, for callers that track it themselves. */
  loading?: boolean;
  /** Replaces the default icon inside the tinted circle. */
  icon?: React.ReactNode;
  /** Where to send focus on close, when opened without a trigger. */
  restoreFocusTo?: React.RefObject<HTMLElement | null>;
  className?: string;
  /** Trigger element. Rendered with `asChild`, so pass a single element. */
  trigger?: React.ReactNode;
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return typeof (value as Promise<unknown> | null)?.then === 'function';
}

function ConfirmDialog({
  open,
  defaultOpen,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  onConfirm,
  loading = false,
  icon,
  restoreFocusTo,
  className,
  trigger,
}: IConfirmDialogProps) {
  const [pending, setPending] = React.useState(false);
  const busy = pending || loading;
  const pageAlreadyDimmed = useOverlayDockScrimActive();

  const handleConfirm = () => {
    const result = onConfirm?.();
    if (!isPromiseLike(result)) return;
    setPending(true);
    const settle = () => {
      setPending(false);
    };
    // Failures belong to the caller, usually through its mutation state, so
    // both branches only clear the pending flag.
    result.then(settle, settle);
  };

  const handleCloseAutoFocus = (event: Event) => {
    const target = restoreFocusTo?.current;
    if (!target) return;
    event.preventDefault();
    target.focus();
  };

  const rootProps = {
    ...(open !== undefined ? { open } : {}),
    ...(defaultOpen !== undefined ? { defaultOpen } : {}),
    ...(onOpenChange ? { onOpenChange } : {}),
  };

  return (
    <Dialog {...rootProps}>
      {trigger !== undefined && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent
        data-slot="confirm-dialog-content"
        data-tone={tone}
        aria-modal="true"
        showCloseButton={false}
        overlayClassName={pageAlreadyDimmed ? 'bg-transparent' : ''}
        onCloseAutoFocus={handleCloseAutoFocus}
        className={cn(
          'flex w-105 flex-col gap-0 rounded-2xl p-0 shadow-xl sm:max-w-105',
          className,
        )}
      >
        <div className="flex flex-col items-start gap-3.5 px-6 pt-6.5 pb-5.5">
          <div
            aria-hidden="true"
            className={cn(
              'flex size-11 shrink-0 items-center justify-center rounded-full',
              tone === 'danger' ? 'bg-danger-bg text-danger' : 'bg-brand-50 text-brand-ink',
            )}
          >
            {icon ?? <XIcon className="size-5.5" />}
          </div>
          <DialogTitle className="type-heading-h2 text-text">{title}</DialogTitle>
          <DialogDescription className="type-body-small text-text-muted">
            {description}
          </DialogDescription>
        </div>
        <div className="flex items-center gap-2.5 px-6 pt-1 pb-5.5">
          <DialogClose asChild>
            <Button variant="outline" className="flex-1" disabled={busy}>
              {cancelLabel}
            </Button>
          </DialogClose>
          <Button
            variant={tone === 'danger' ? 'destructive' : 'default'}
            className="flex-1"
            disabled={busy}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { ConfirmDialog };
