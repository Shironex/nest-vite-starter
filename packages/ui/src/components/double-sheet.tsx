'use client';

import * as React from 'react';
import { ChevronRightIcon } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Dialog as SheetPrimitive } from 'radix-ui';

import { cn } from '@repo/ui/lib/utils';
import {
  OverlayDockPresence,
  useOverlayDockLayer,
  OVERLAY_FADE_CLASS,
  OVERLAY_SCRIM_CLASS,
  OVERLAY_SLIDE_RIGHT_CLASS,
} from '@repo/ui/lib/overlay';

/**
 * Double sheet: the create / edit form sheet of the overlay convention.
 *
 * It docks to the LEFT of an open `DetailDrawer`, so the page reads left to
 * right as main content, edit sheet, detail drawer. It is not a centered modal
 * and it does not stack on top of the drawer. Opened on its own, with no drawer
 * present, it simply becomes the right-most panel.
 *
 * Layering falls out of the shared overlay dock: the bottom-most open panel
 * owns the tinted scrim, Radix closes only the top-most layer on Escape, and
 * focus returns to whatever opened the sheet, which for the documented flow is
 * a control inside the drawer.
 */

export interface IDoubleSheetProps extends Omit<
  React.ComponentProps<typeof SheetPrimitive.Root>,
  'modal'
> {
  children?: React.ReactNode;
}

function DoubleSheet({ ...props }: IDoubleSheetProps) {
  return <SheetPrimitive.Root data-slot="double-sheet" modal {...props} />;
}

function DoubleSheetTrigger({ ...props }: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="double-sheet-trigger" {...props} />;
}

function DoubleSheetClosePrimitive({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="double-sheet-close-primitive" {...props} />;
}

const doubleSheetContentVariants = cva(
  'pointer-events-auto relative z-10 flex h-full flex-col overflow-hidden border-l border-border bg-surface shadow-lg outline-none',
  {
    variants: {
      size: {
        sm: 'w-screen sm:w-96',
        md: 'w-screen sm:w-120',
        lg: 'w-screen sm:w-160',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
);

export interface IDoubleSheetContentProps
  extends
    React.ComponentProps<typeof SheetPrimitive.Content>,
    VariantProps<typeof doubleSheetContentVariants> {
  /**
   * Accessible description, rendered for screen readers only. Omit it and the
   * sheet carries no `aria-describedby`, which keeps Radix from warning about a
   * dangling id.
   */
  description?: React.ReactNode;
  /**
   * Where to send focus when the sheet closes. Only needed when the sheet is
   * opened programmatically. A `DoubleSheetTrigger` rendered inside the drawer
   * is restored automatically, which is what keeps Escape from dropping the
   * user out of the drawer.
   */
  restoreFocusTo?: React.RefObject<HTMLElement | null>;
}

function DoubleSheetContent({
  className,
  children,
  size,
  description,
  restoreFocusTo,
  onCloseAutoFocus,
  ...props
}: IDoubleSheetContentProps) {
  const { host, isBase } = useOverlayDockLayer();
  const suppressDescribedBy = description === undefined && props['aria-describedby'] === undefined;

  const handleCloseAutoFocus = (event: Event) => {
    onCloseAutoFocus?.(event);
    if (event.defaultPrevented) return;
    const target = restoreFocusTo?.current;
    if (!target) return;
    // Preventing the default stops Radix from also focusing its own trigger.
    event.preventDefault();
    target.focus();
  };

  if (!host) return null;

  return (
    <SheetPrimitive.Portal container={host}>
      <SheetPrimitive.Overlay
        data-slot="double-sheet-overlay"
        className={cn(
          'fixed inset-0 z-0',
          OVERLAY_FADE_CLASS,
          isBase ? OVERLAY_SCRIM_CLASS : 'bg-transparent',
        )}
      >
        <OverlayDockPresence host={host} kind="sheet" />
      </SheetPrimitive.Overlay>
      <SheetPrimitive.Content
        data-slot="double-sheet-content"
        aria-modal="true"
        className={cn(doubleSheetContentVariants({ size }), OVERLAY_SLIDE_RIGHT_CLASS, className)}
        onCloseAutoFocus={handleCloseAutoFocus}
        {...props}
        {...(suppressDescribedBy ? { 'aria-describedby': undefined } : {})}
      >
        <OverlayDockPresence host={host} kind="sheet" />
        {description !== undefined && (
          <SheetPrimitive.Description className="sr-only">{description}</SheetPrimitive.Description>
        )}
        {children}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

function DoubleSheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="double-sheet-header"
      className={cn(
        'flex shrink-0 items-center gap-2.5 border-b border-border bg-surface px-6 py-4',
        className,
      )}
      {...props}
    />
  );
}

function DoubleSheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="double-sheet-title"
      className={cn('min-w-0 flex-1 truncate type-heading-h2 text-text', className)}
      {...props}
    />
  );
}

export interface IDoubleSheetCloseProps extends React.ComponentProps<typeof SheetPrimitive.Close> {
  /** Accessible name for the icon button. Screens pass the localized label. */
  label?: string;
}

/**
 * Dismiss control. The chevron points right because the sheet slides back out
 * towards the drawer it belongs to, which is how the reference flow reads.
 */
function DoubleSheetClose({
  className,
  children,
  label = 'Close',
  ...props
}: IDoubleSheetCloseProps) {
  return (
    <SheetPrimitive.Close
      data-slot="double-sheet-close"
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-text-muted transition-colors outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      {...props}
    >
      {children ?? <ChevronRightIcon className="size-5" aria-hidden="true" />}
      <span className="sr-only">{label}</span>
    </SheetPrimitive.Close>
  );
}

/**
 * `relative` is load bearing, not decoration.
 *
 * Radix renders a hidden `position: absolute` native control next to every
 * Checkbox and Select so the form still submits natively, and an absolutely
 * positioned element is laid out against its nearest POSITIONED ancestor. With
 * an unpositioned body those hidden inputs skip past the scroller they belong
 * to and attach to `DoubleSheetContent`, which is `relative`. The body's
 * `overflow-y: auto` then cannot clip them, so the shell's scrollable height
 * grows to reach the lowest one and the shell silently becomes a scroll
 * container. `overflow: hidden` on the shell blocks the USER from scrolling it
 * but not the BROWSER: focusing an invalid field after a failed submit scrolls
 * every scrollable ancestor, sliding the whole sheet up by its header height
 * and taking the footer's submit button with it.
 *
 * Rule: any scroll container that can hold Radix form primitives must be its
 * own containing block. Pinned by `apps/web/e2e/form-reflow.spec.ts`.
 */
function DoubleSheetBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="double-sheet-body"
      className={cn(
        'relative flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5',
        className,
      )}
      {...props}
    />
  );
}

export interface IDoubleSheetSectionProps extends Omit<React.ComponentProps<'section'>, 'title'> {
  title?: React.ReactNode;
}

function DoubleSheetSection({ className, title, children, ...props }: IDoubleSheetSectionProps) {
  return (
    <section
      data-slot="double-sheet-section"
      className={cn('flex flex-col gap-3', className)}
      {...props}
    >
      {title !== undefined && <h3 className="type-heading-h3 text-text">{title}</h3>}
      {children}
    </section>
  );
}

function DoubleSheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="double-sheet-footer"
      className={cn(
        'mt-auto flex shrink-0 items-center justify-end gap-2.5 border-t border-border bg-surface px-6 py-4',
        className,
      )}
      {...props}
    />
  );
}

export {
  DoubleSheet,
  DoubleSheetTrigger,
  DoubleSheetContent,
  DoubleSheetHeader,
  DoubleSheetTitle,
  DoubleSheetClose,
  DoubleSheetClosePrimitive,
  DoubleSheetBody,
  DoubleSheetSection,
  DoubleSheetFooter,
  doubleSheetContentVariants,
};
