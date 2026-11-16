import { z } from 'zod';

/**
 * Workspace wire schemas: the workspaces of one organization, the second tier of the
 * Organization -> Workspace tenancy boundary.
 *
 * Platform, not domain. Workspace is the scope every tenant-owned record below the
 * organization hangs off. Nothing here may import from a domain schema file; domain
 * files import from here.
 */

// --- workspaces router ----------------------------------------------------------

/**
 * The workspaces of one organization. Every Workspace-scoped write path asserts the
 * Workspace is in the caller's tenant, so the staff UI needs
 * a read surface to populate its Workspace pickers and filter chips, and a create
 * surface because self-signup provisions a Tenant with no Workspace at all.
 *
 * Registration identity (legal name, registered address) is nullable
 * end-to-end: an organization may record a client before its paperwork arrives.
 *
 * `legalName` is the registered legal name. It is OPTIONAL rather than
 * required, deliberately. The column is nullable and existing rows hold null,
 * so a required field on update would make every pre-existing Workspace
 * uneditable, and a required field on create would block recording a client
 * whose registration papers have not arrived, the exact case the other three
 * fields exist to tolerate.
 */
const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  legalName: z.string().nullable(),
  street: z.string().nullable(),
  postalCode: z.string().nullable(),
  city: z.string().nullable(),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const workspaceListOutput = z.object({ workspaces: z.array(workspaceSchema) });
export type WorkspaceListOutput = z.infer<typeof workspaceListOutput>;

/** Registration bounds. */
const workspaceRegistrationFields = {
  // The registered name in full, including the legal form ("Ltd.",
  // "Limited Liability Company"), which is why the bound is looser than the
  // 200 of `name`: `name` is the organization's working label and may be shortened,
  // legalName is copied verbatim onto filed documents and may not be.
  legalName: z.string().trim().min(1).max(300),
  street: z.string().trim().min(1).max(200),
  postalCode: z.string().trim().min(1).max(12),
  city: z.string().trim().min(1).max(100),
};

export const workspaceCreateInput = z.object({
  name: z.string().trim().min(1).max(200),
  legalName: workspaceRegistrationFields.legalName.optional(),
  street: workspaceRegistrationFields.street.optional(),
  postalCode: workspaceRegistrationFields.postalCode.optional(),
  city: workspaceRegistrationFields.city.optional(),
});
export type WorkspaceCreateInput = z.infer<typeof workspaceCreateInput>;

export const workspaceCreateOutput = workspaceSchema;
export type WorkspaceCreateOutput = z.infer<typeof workspaceCreateOutput>;

/** null clears a nullable column; an absent key leaves it untouched. */
export const workspaceUpdateInput = z.object({
  workspaceId: z.string(),
  name: z.string().trim().min(1).max(200).optional(),
  legalName: workspaceRegistrationFields.legalName.nullable().optional(),
  street: workspaceRegistrationFields.street.nullable().optional(),
  postalCode: workspaceRegistrationFields.postalCode.nullable().optional(),
  city: workspaceRegistrationFields.city.nullable().optional(),
});
export type WorkspaceUpdateInput = z.infer<typeof workspaceUpdateInput>;

export const workspaceUpdateOutput = workspaceSchema;
export type WorkspaceUpdateOutput = z.infer<typeof workspaceUpdateOutput>;
