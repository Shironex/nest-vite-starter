'use client';

import * as React from 'react';
import { XIcon } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Dialog as DrawerPrimitive, Tabs as TabsPrimitive } from 'radix-ui';

import { cn } from '@repo/ui/lib/utils';
import {
  OverlayDockPresence,
  useOverlayDockLayer,
  OVERLAY_FADE_CLASS,
  OVERLAY_SCRIM_CLASS,
  OVERLAY_SLIDE_RIGHT_CLASS,
} from '@repo/ui/lib/overlay';

/**
 * Detail drawer: a right-edge panel showing one record, with tabs and per
 * section actions. Generic by construction, the tabs and sections are
 * composition, not props.
 *
 * It renders into the shared overlay dock, so a `DoubleSheet` can open beside
 * it without either panel fighting for `right: 0`.
 */

export interface IDetailDrawerProps extends Omit<
  React.ComponentProps<typeof DrawerPrimitive.Root>,
  'modal'
> {
  children?: React.ReactNode;
}

function DetailDrawer({ ...props }: IDetailDrawerProps) {
  return <DrawerPrimitive.Root data-slot="detail-drawer" modal {...props} />;
}

function DetailDrawerTrigger({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Trigger>) {
  return <DrawerPrimitive.Trigger data-slot="detail-drawer-trigger" {...props} />;
}

const detailDrawerContentVariants = cva(
  'pointer-events-auto relative z-10 flex h-full flex-col overflow-hidden border-l border-border bg-surface shadow-lg outline-none',
  {
    variants: {
      size: {
        sm: 'w-screen sm:w-96',
        md: 'w-screen sm:w-110',
        lg: 'w-screen sm:w-140',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
);

export interface IDetailDrawerContentProps
  extends
    React.ComponentProps<typeof DrawerPrimitive.Content>,
    VariantProps<typeof detailDrawerContentVariants> {
  /**
   * Accessible description, rendered for screen readers only. Omit it and the
   * drawer carries no `aria-describedby` at all, which is valid and keeps Radix
   * from warning about a dangling id.
   */
  description?: React.ReactNode;
  /**
   * Where to send focus when the drawer closes. Only needed when the drawer is
   * opened programmatically; a `DetailDrawerTrigger` is restored automatically.
   */
  restoreFocusTo?: React.RefObject<HTMLElement | null>;
}

function DetailDrawerContent({
  className,
  children,
  size,
  description,
  restoreFocusTo,
  onCloseAutoFocus,
  ...props
}: IDetailDrawerContentProps) {
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
    <DrawerPrimitive.Portal container={host}>
      <DrawerPrimitive.Overlay
        data-slot="detail-drawer-overlay"
        className={cn(
          'fixed inset-0 z-0',
          OVERLAY_FADE_CLASS,
          isBase ? OVERLAY_SCRIM_CLASS : 'bg-transparent',
        )}
      >
        <OverlayDockPresence host={host} kind="drawer" />
      </DrawerPrimitive.Overlay>
      <DrawerPrimitive.Content
        data-slot="detail-drawer-content"
        aria-modal="true"
        className={cn(detailDrawerContentVariants({ size }), OVERLAY_SLIDE_RIGHT_CLASS, className)}
        onCloseAutoFocus={handleCloseAutoFocus}
        {...props}
        {...(suppressDescribedBy ? { 'aria-describedby': undefined } : {})}
      >
        <OverlayDockPresence host={host} kind="drawer" />
        {description !== undefined && (
          <DrawerPrimitive.Description className="sr-only">
            {description}
          </DrawerPrimitive.Description>
        )}
        {children}
      </DrawerPrimitive.Content>
    </DrawerPrimitive.Portal>
  );
}

function DetailDrawerHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="detail-drawer-header"
      className={cn(
        'flex shrink-0 items-center gap-2.5 border-b border-border bg-surface p-4',
        className,
      )}
      {...props}
    />
  );
}

function DetailDrawerTitle({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="detail-drawer-title"
      className={cn('min-w-0 flex-1 truncate type-heading-h3 text-text', className)}
      {...props}
    />
  );
}

export interface IDetailDrawerCloseProps extends React.ComponentProps<
  typeof DrawerPrimitive.Close
> {
  /** Accessible name for the icon button. Screens pass the localized label. */
  label?: string;
}

function DetailDrawerClose({
  className,
  children,
  label = 'Close',
  ...props
}: IDetailDrawerCloseProps) {
  return (
    <DrawerPrimitive.Close
      data-slot="detail-drawer-close"
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-text-muted transition-colors outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      {...props}
    >
      {children ?? <XIcon className="size-5" aria-hidden="true" />}
      <span className="sr-only">{label}</span>
    </DrawerPrimitive.Close>
  );
}

/** Identity block under the header: avatar, name, status, contact rows. */
function DetailDrawerSummary({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="detail-drawer-summary"
      className={cn('flex shrink-0 flex-col gap-3 bg-surface px-5 pt-5 pb-4', className)}
      {...props}
    />
  );
}

function DetailDrawerTabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="detail-drawer-tabs"
      className={cn('flex min-h-0 flex-1 flex-col', className)}
      {...props}
    />
  );
}

function DetailDrawerTabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="detail-drawer-tabs-list"
      className={cn(
        'flex shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-border bg-surface px-4',
        className,
      )}
      {...props}
    />
  );
}

function DetailDrawerTab({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="detail-drawer-tab"
      className={cn(
        '-mb-px shrink-0 border-b-2 border-transparent px-2 py-2.5 type-label-caption whitespace-nowrap text-text-tertiary transition-colors outline-none',
        'hover:text-text-secondary',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        'disabled:pointer-events-none disabled:opacity-50',
        'data-[state=active]:border-brand data-[state=active]:text-text',
        className,
      )}
      {...props}
    />
  );
}

/**
 * `relative` is load bearing here for the same reason it is on
 * `DoubleSheetBody`: a scroll container that can hold Radix form primitives
 * must be its own containing block, or their hidden absolutely positioned
 * native controls escape to the `relative` shell and make it scrollable behind
 * its own `overflow: hidden`. See the note on `DoubleSheetBody` for the full
 * chain. Latent rather than observed for the tab panels today, because every
 * form control in the app currently lives in a portaled sheet rather than
 * inline in a tab, but a tab that renders a Checkbox or Select directly would
 * reproduce it exactly.
 */
function DetailDrawerTabPanel({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="detail-drawer-tab-panel"
      className={cn(
        // Radix gives Tabs.Content tabIndex={0}; without a focus-visible ring
        // the tab stop is invisible (see tabs.tsx).
        'relative flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto bg-bg px-5 py-4.5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        className,
      )}
      {...props}
    />
  );
}

/** Scrolling body for a drawer without tabs. `relative` as above. */
function DetailDrawerBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="detail-drawer-body"
      className={cn(
        'relative flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto bg-bg px-5 py-4.5',
        className,
      )}
      {...props}
    />
  );
}

export interface IDetailDrawerSectionProps extends Omit<React.ComponentProps<'section'>, 'title'> {
  title: React.ReactNode;
  /** Per section Edit / Add control, rendered opposite the title. */
  action?: React.ReactNode;
}

function DetailDrawerSection({
  className,
  title,
  action,
  children,
  ...props
}: IDetailDrawerSectionProps) {
  return (
    <section
      data-slot="detail-drawer-section"
      className={cn('flex flex-col gap-2', className)}
      {...props}
    >
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h3 className="type-label-overline text-text-muted">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Card surface for the rows inside a section. */
function DetailDrawerCard({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="detail-drawer-card"
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border border-border bg-surface',
        className,
      )}
      {...props}
    />
  );
}

function DetailDrawerFields({ className, ...props }: React.ComponentProps<'dl'>) {
  return (
    <dl
      data-slot="detail-drawer-fields"
      className={cn('flex flex-col px-4 pt-1.5 pb-2.5', className)}
      {...props}
    />
  );
}

export interface IDetailDrawerFieldProps extends React.ComponentProps<'div'> {
  label: React.ReactNode;
}

function DetailDrawerField({ className, label, children, ...props }: IDetailDrawerFieldProps) {
  return (
    <div
      data-slot="detail-drawer-field"
      className={cn('flex items-center gap-3 py-2', className)}
      {...props}
    >
      <dt className="min-w-0 flex-1 type-body-small text-text-muted">{label}</dt>
      <dd className="text-right type-body-small text-text">{children}</dd>
    </div>
  );
}

function DetailDrawerFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="detail-drawer-footer"
      className={cn(
        'mt-auto flex shrink-0 items-center justify-end gap-2.5 border-t border-border bg-surface px-5 py-4',
        className,
      )}
      {...props}
    />
  );
}

export {
  DetailDrawer,
  DetailDrawerTrigger,
  DetailDrawerContent,
  DetailDrawerHeader,
  DetailDrawerTitle,
  DetailDrawerClose,
  DetailDrawerSummary,
  DetailDrawerTabs,
  DetailDrawerTabsList,
  DetailDrawerTab,
  DetailDrawerTabPanel,
  DetailDrawerBody,
  DetailDrawerSection,
  DetailDrawerCard,
  DetailDrawerFields,
  DetailDrawerField,
  DetailDrawerFooter,
  detailDrawerContentVariants,
};
