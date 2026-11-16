# SaaS Starter overlay primitives

Three primitives in `@repo/ui` cover every create / read / edit / delete flow in
the product. They are the interaction convention, not generic UI, so use them as
written rather than reaching for `Dialog` or `Sheet` directly.

| Convention                | Component       | Import                    |
| ------------------------- | --------------- | ------------------------- |
| Look at one record        | `DetailDrawer`  | `@repo/ui/detail-drawer`  |
| Create or edit a record   | `DoubleSheet`   | `@repo/ui/double-sheet`   |
| Confirm a destructive act | `ConfirmDialog` | `@repo/ui/confirm-dialog` |

The rule in one line: **a centered modal is only ever a confirmation.** Adding or
editing opens a second sheet docked to the LEFT of the detail drawer, so the page
reads left to right as main content, edit sheet, detail drawer.

```
┌────────────────────────────┬───────────────┬────────────┐
│ main content (scrimmed)    │ DoubleSheet   │ DetailDraw │
└────────────────────────────┴───────────────┴────────────┘
```

## How the layering works

Both panels render into a **shared overlay dock**: one `position: fixed`,
right-anchored flex row appended to `document.body`. Each panel rents a host
element inside it and portals its Radix dialog there, so the panels lay out as
flex siblings instead of stacking. The drawer never assumes it owns the right
edge on its own.

There is **no provider to mount.** The dock is created on first use and removed
when the last panel closes. Nothing needs to change in the app shell.

What falls out of that, for free:

- **Escape closes the top-most layer only.** Radix keeps a global dismissable
  layer stack. With drawer plus sheet open, Escape closes the sheet and leaves
  the drawer open.
- **Focus returns to the trigger.** Open the sheet from a `DoubleSheetTrigger`
  inside the drawer and Escape puts focus back on that button, that is to say
  back inside the drawer. When you open a panel programmatically instead of from
  a trigger, pass `restoreFocusTo` or focus goes nowhere.
- **One scrim.** The bottom-most open panel is the only one that tints; upper
  layers render a transparent overlay. Two open panels never darken the page
  twice. A `ConfirmDialog` opened from inside a drawer drops its own scrim for
  the same reason.
- **One scroll lock.** Radix's `react-remove-scroll` is ref counted, so the lock
  applies once and lifts only when the last panel closes.
- **`aria-hidden` on the layers below.** While the sheet is open the drawer is
  hidden from assistive tech and is not reachable by a role query. Grab any
  in-drawer element you need before opening the sheet.
- **Reduced motion.** The slide and fade carry `motion-reduce:animate-none!`.
  Radix `Presence` treats a computed `animation-name: none` as nothing to wait
  for, so panels still unmount cleanly.
- **Below `sm`** only the top-most panel is shown; the double sheet degrades to
  a single full-width sheet stack.

## Usage: drawer plus double sheet

```tsx
import { Button } from '@repo/ui/button';
import {
  DetailDrawer,
  DetailDrawerTrigger,
  DetailDrawerContent,
  DetailDrawerHeader,
  DetailDrawerClose,
  DetailDrawerTitle,
  DetailDrawerSummary,
  DetailDrawerTabs,
  DetailDrawerTabsList,
  DetailDrawerTab,
  DetailDrawerTabPanel,
  DetailDrawerSection,
  DetailDrawerCard,
  DetailDrawerFields,
  DetailDrawerField,
} from '@repo/ui/detail-drawer';
import {
  DoubleSheet,
  DoubleSheetTrigger,
  DoubleSheetContent,
  DoubleSheetHeader,
  DoubleSheetClose,
  DoubleSheetTitle,
  DoubleSheetBody,
  DoubleSheetSection,
  DoubleSheetFooter,
  DoubleSheetClosePrimitive,
} from '@repo/ui/double-sheet';

<DetailDrawer open={Boolean(selectedId)} onOpenChange={(open) => !open && clearSelection()}>
  <DetailDrawerContent description="Workspace card">
    <DetailDrawerHeader>
      <DetailDrawerClose label="Close" />
      <DetailDrawerTitle>Workspace details</DetailDrawerTitle>
    </DetailDrawerHeader>

    <DetailDrawerSummary>{/* avatar, name, status, contact */}</DetailDrawerSummary>

    <DetailDrawerTabs defaultValue="contacts">
      <DetailDrawerTabsList aria-label="Workspace card sections">
        <DetailDrawerTab value="details">Workspace details</DetailDrawerTab>
        <DetailDrawerTab value="contacts">Contacts</DetailDrawerTab>
      </DetailDrawerTabsList>

      <DetailDrawerTabPanel value="contacts">
        {/* the double sheet lives in the section action */}
        <DetailDrawerSection
          title="Contacts"
          action={
            <DoubleSheet>
              <DoubleSheetTrigger asChild>
                <Button size="sm">Add contact</Button>
              </DoubleSheetTrigger>
              <DoubleSheetContent description="New contact form">
                <DoubleSheetHeader>
                  <DoubleSheetClose label="Close form" />
                  <DoubleSheetTitle>Add contact</DoubleSheetTitle>
                </DoubleSheetHeader>
                <DoubleSheetBody>
                  <DoubleSheetSection title="General">{/* form fields */}</DoubleSheetSection>
                </DoubleSheetBody>
                <DoubleSheetFooter>
                  <DoubleSheetClosePrimitive asChild>
                    <Button variant="outline">Cancel</Button>
                  </DoubleSheetClosePrimitive>
                  <Button type="submit" form="contact-form">
                    Save
                  </Button>
                </DoubleSheetFooter>
              </DoubleSheetContent>
            </DoubleSheet>
          }
        >
          <DetailDrawerCard>
            <DetailDrawerFields>
              <DetailDrawerField label="Status">Active</DetailDrawerField>
            </DetailDrawerFields>
          </DetailDrawerCard>
        </DetailDrawerSection>
      </DetailDrawerTabPanel>
    </DetailDrawerTabs>
  </DetailDrawerContent>
</DetailDrawer>;
```

## Usage: delete confirmation

```tsx
import { ConfirmDialog } from '@repo/ui/confirm-dialog';

<ConfirmDialog
  open={confirmOpen}
  onOpenChange={setConfirmOpen}
  title="Delete this workspace?"
  description="This permanently deletes Northwind Ltd and its related data. This cannot be undone."
  confirmLabel="Delete"
  cancelLabel="Cancel"
  loading={remove.isPending}
  onConfirm={() => remove.mutateAsync(id).then(() => setConfirmOpen(false))}
/>;
```

`ConfirmDialog` takes no `children`, on purpose: there is no slot for a form to
grow into, so it cannot quietly become a general purpose modal. It does not
close itself and it does not surface failures; the caller owns both. Initial
focus lands on the cancel button.

## Props

### `DetailDrawer` / `DoubleSheet` roots

Radix `Dialog.Root` props minus `modal`, which is always on:
`open`, `defaultOpen`, `onOpenChange`, `children`.

### `DetailDrawerContent` / `DoubleSheetContent`

| Prop                                  | Type                                   | Default | Notes                                                              |
| ------------------------------------- | -------------------------------------- | ------- | ------------------------------------------------------------------ |
| `size`                                | `'sm' \| 'md' \| 'lg'`                 | `'md'`  | drawer 384 / 440 / 560px, sheet 384 / 480 / 640px                  |
| `description`                         | `React.ReactNode`                      | none    | rendered screen-reader only; omit and no `aria-describedby` is set |
| `restoreFocusTo`                      | `React.RefObject<HTMLElement \| null>` | none    | only needed when opened without a trigger                          |
| plus all Radix `Dialog.Content` props |

### Composition parts

Drawer: `DetailDrawerTrigger`, `DetailDrawerHeader`, `DetailDrawerTitle`,
`DetailDrawerClose` (`label`), `DetailDrawerSummary`, `DetailDrawerTabs`,
`DetailDrawerTabsList`, `DetailDrawerTab`, `DetailDrawerTabPanel`,
`DetailDrawerBody`, `DetailDrawerSection` (`title`, `action`),
`DetailDrawerCard`, `DetailDrawerFields`, `DetailDrawerField` (`label`),
`DetailDrawerFooter`.

Sheet: `DoubleSheetTrigger`, `DoubleSheetHeader`, `DoubleSheetTitle`,
`DoubleSheetClose` (`label`), `DoubleSheetClosePrimitive` (unstyled, for
`asChild` around a footer button), `DoubleSheetBody`, `DoubleSheetSection`
(`title`), `DoubleSheetFooter`.

Tabs go through Radix `Tabs`, so the WAI-ARIA tabs pattern and arrow-key
navigation come with them. Give `DetailDrawerTabsList` an `aria-label`.

### `ConfirmDialog`

| Prop                                  | Type                                   | Default                  |
| ------------------------------------- | -------------------------------------- | ------------------------ |
| `title`, `description`                | `React.ReactNode`                      | required                 |
| `confirmLabel`, `cancelLabel`         | `React.ReactNode`                      | `'Confirm'` / `'Cancel'` |
| `tone`                                | `'danger' \| 'default'`                | `'danger'`               |
| `onConfirm`                           | `() => void \| Promise<unknown>`       | none                     |
| `loading`                             | `boolean`                              | `false`                  |
| `icon`                                | `React.ReactNode`                      | `XIcon`                  |
| `open`, `defaultOpen`, `onOpenChange` | Radix dialog state                     | none                     |
| `trigger`                             | `React.ReactNode` (`asChild`)          | none                     |
| `restoreFocusTo`                      | `React.RefObject<HTMLElement \| null>` | none                     |

An `onConfirm` that returns a promise disables both buttons until it settles.

## Copy

The library defaults are English, matching the rest of `@repo/ui`. Screens pass
their catalog copy through the props, for example `label={t('actions.close')}`,
`confirmLabel={t('actions.delete')}`, `cancelLabel={t('actions.cancel')}`.
