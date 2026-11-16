import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { MailIcon, MoreVerticalIcon, PhoneIcon, PlusIcon } from 'lucide-react';

import { Button } from './button';
import { Badge } from './badge';
import { Input } from './input';
import { Label } from './label';
import { ConfirmDialog } from './confirm-dialog';
import {
  DetailDrawer,
  DetailDrawerCard,
  DetailDrawerClose,
  DetailDrawerContent,
  DetailDrawerField,
  DetailDrawerFields,
  DetailDrawerHeader,
  DetailDrawerSection,
  DetailDrawerSummary,
  DetailDrawerTab,
  DetailDrawerTabPanel,
  DetailDrawerTabs,
  DetailDrawerTabsList,
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

const meta = {
  title: 'Starter/Overlays',
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function PageBackdrop({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col gap-4 bg-bg p-8">
      <h1 className="type-heading-h1 text-text">Workspaces</h1>
      <p className="max-w-prose type-body-regular text-text-muted">
        Open the workspace card to see the detail drawer. The action in a section opens a second
        sheet docked to the LEFT of the drawer, not a centered dialog.
      </p>
      {children}
    </div>
  );
}

function WorkspaceSummary() {
  return (
    <DetailDrawerSummary>
      <div className="flex items-center gap-3.5">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand-100">
          <span className="type-heading-h2 text-brand-ink">AC</span>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="truncate type-heading-h2 text-text">Alfa Consulting LLC</span>
            <Badge className="bg-success-bg text-success">Active</Badge>
          </div>
          <span className="type-body-small text-text-muted">Organization client</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <MailIcon className="size-4 text-text-muted" aria-hidden="true" />
        <span className="type-body-small text-text-secondary">office@example.com</span>
      </div>
      <div className="flex items-center gap-2">
        <PhoneIcon className="size-4 text-text-muted" aria-hidden="true" />
        <span className="type-body-small text-text-secondary">+1 555-0105</span>
      </div>
    </DetailDrawerSummary>
  );
}

function AddContactSheet() {
  return (
    <DoubleSheet>
      <DoubleSheetTrigger asChild>
        <Button className="w-full">
          <PlusIcon aria-hidden="true" />
          Add contact
        </Button>
      </DoubleSheetTrigger>
      <DoubleSheetContent description="New workspace contact form">
        <DoubleSheetHeader>
          <DoubleSheetClose label="Close form" />
          <DoubleSheetTitle>Add contact</DoubleSheetTitle>
        </DoubleSheetHeader>
        <DoubleSheetBody>
          <DoubleSheetSection title="General">
            <div className="flex flex-col gap-2">
              <Label htmlFor="story-contact-name">Full name</Label>
              <Input id="story-contact-name" placeholder="Jane Doe" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="story-contact-role">Role</Label>
              <Input id="story-contact-role" placeholder="For example accounting, management" />
            </div>
          </DoubleSheetSection>
          <DoubleSheetSection title="Contact">
            <div className="flex flex-col gap-2">
              <Label htmlFor="story-contact-email">E-mail</Label>
              <Input id="story-contact-email" placeholder="jane@example.com" />
            </div>
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
  );
}

/**
 * The full convention: detail drawer on the right edge, the add form docked to
 * its left, and a centered modal used only to confirm the destructive action.
 */
export const DrawerWithDoubleSheet: Story = {
  render: () => (
    <PageBackdrop>
      <DetailDrawer>
        <DetailDrawerTrigger asChild>
          <Button className="self-start">Open workspace card</Button>
        </DetailDrawerTrigger>
        <DetailDrawerContent description="Workspace card Alfa Consulting LLC">
          <DetailDrawerHeader>
            <DetailDrawerClose label="Close" />
            <DetailDrawerTitle>Workspace details</DetailDrawerTitle>
            <Button variant="ghost" size="icon-sm" aria-label="More options">
              <MoreVerticalIcon aria-hidden="true" />
            </Button>
          </DetailDrawerHeader>
          <WorkspaceSummary />
          <DetailDrawerTabs defaultValue="contacts">
            <DetailDrawerTabsList aria-label="Workspace card sections">
              <DetailDrawerTab value="details">Workspace details</DetailDrawerTab>
              <DetailDrawerTab value="contacts">Contacts</DetailDrawerTab>
              <DetailDrawerTab value="documents">Documents</DetailDrawerTab>
              <DetailDrawerTab value="history">History</DetailDrawerTab>
            </DetailDrawerTabsList>

            <DetailDrawerTabPanel value="details">
              <DetailDrawerSection
                title="Workspace details"
                action={
                  <DoubleSheet>
                    <DoubleSheetTrigger asChild>
                      <Button variant="ghost" size="sm">
                        Edit
                      </Button>
                    </DoubleSheetTrigger>
                    <DoubleSheetContent description="Edit workspace details form">
                      <DoubleSheetHeader>
                        <DoubleSheetClose label="Close form" />
                        <DoubleSheetTitle>Edit workspace details</DoubleSheetTitle>
                      </DoubleSheetHeader>
                      <DoubleSheetBody>
                        <div className="flex flex-col gap-2">
                          <Label htmlFor="story-name">Name</Label>
                          <Input id="story-name" defaultValue="Alfa Consulting LLC" />
                        </div>
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
                <DetailDrawerCard>
                  <DetailDrawerFields>
                    <DetailDrawerField label="Tax ID">5250001009</DetailDrawerField>
                    <DetailDrawerField label="City">Springfield</DetailDrawerField>
                  </DetailDrawerFields>
                </DetailDrawerCard>
              </DetailDrawerSection>
            </DetailDrawerTabPanel>

            <DetailDrawerTabPanel value="contacts">
              <AddContactSheet />
              <DetailDrawerSection title="Contact person">
                <DetailDrawerCard>
                  <DetailDrawerFields>
                    <DetailDrawerField label="Full name">Casey Nguyen</DetailDrawerField>
                    <DetailDrawerField label="Role">Accounting</DetailDrawerField>
                    <DetailDrawerField label="Email">casey.nguyen@example.com</DetailDrawerField>
                    <DetailDrawerField label="From">02/01/2025</DetailDrawerField>
                  </DetailDrawerFields>
                </DetailDrawerCard>
              </DetailDrawerSection>
              <DetailDrawerSection
                title="Danger zone"
                action={
                  <ConfirmDialog
                    title="Delete this workspace?"
                    description="This removes the workspace Alfa Consulting LLC together with its related data. This action cannot be undone."
                    confirmLabel="Delete"
                    cancelLabel="Cancel"
                    trigger={
                      <Button variant="ghost" size="sm" className="text-danger">
                        Delete
                      </Button>
                    }
                  />
                }
              >
                <p className="type-body-small text-text-muted">
                  Deleting a workspace cannot be undone.
                </p>
              </DetailDrawerSection>
            </DetailDrawerTabPanel>

            <DetailDrawerTabPanel value="documents">
              <p className="type-body-regular text-text-muted">No documents.</p>
            </DetailDrawerTabPanel>
            <DetailDrawerTabPanel value="history">
              <p className="type-body-regular text-text-muted">No changes this year.</p>
            </DetailDrawerTabPanel>
          </DetailDrawerTabs>
        </DetailDrawerContent>
      </DetailDrawer>
    </PageBackdrop>
  ),
};

/** A create sheet opened straight from a list page, with no drawer behind it. */
export const SheetWithoutDrawer: Story = {
  render: () => (
    <PageBackdrop>
      <DoubleSheet>
        <DoubleSheetTrigger asChild>
          <Button className="self-start">
            <PlusIcon aria-hidden="true" />
            Add workspace
          </Button>
        </DoubleSheetTrigger>
        <DoubleSheetContent description="New workspace form">
          <DoubleSheetHeader>
            <DoubleSheetClose label="Close form" />
            <DoubleSheetTitle>Add workspace</DoubleSheetTitle>
          </DoubleSheetHeader>
          <DoubleSheetBody>
            <DoubleSheetSection title="Workspace details">
              <div className="flex flex-col gap-2">
                <Label htmlFor="story-new-name">Name</Label>
                <Input id="story-new-name" placeholder="Beta Consulting Inc." />
              </div>
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
    </PageBackdrop>
  ),
};

/** Centered modals are reserved for confirmations. */
export const DeleteConfirmation: Story = {
  render: () => (
    <PageBackdrop>
      <ConfirmDialog
        title="Delete this workspace?"
        description="This removes the workspace Northwind Trading Ltd together with its related data. This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        trigger={
          <Button variant="destructive" className="self-start">
            Delete workspace
          </Button>
        }
      />
    </PageBackdrop>
  ),
};
