import { describe, expect, it } from 'vitest';
import { workspaceCreateInput, workspaceUpdateInput } from './workspace';

describe('workspace registration inputs', () => {
  it('creates with no registration data at all', () => {
    expect(workspaceCreateInput.safeParse({ name: 'Northwind' }).success).toBe(true);
  });

  it('validates registration data when present', () => {
    const full = workspaceCreateInput.safeParse({
      name: 'Northwind',
      legalName: 'Northwind Traders Limited',
      street: ' Main St 1 ',
      postalCode: '12345',
      city: 'Springfield',
    });
    expect(full).toMatchObject({ success: true, data: { street: 'Main St 1' } });

    expect(workspaceCreateInput.safeParse({ name: 'Northwind', street: '   ' }).success).toBe(
      false,
    );
    expect(
      workspaceCreateInput.safeParse({ name: 'Northwind', postalCode: '1'.repeat(13) }).success,
    ).toBe(false);
    expect(
      workspaceCreateInput.safeParse({ name: 'Northwind', city: 'x'.repeat(101) }).success,
    ).toBe(false);
  });

  it('distinguishes clearing a field (null) from leaving it untouched (absent) on update', () => {
    const cleared = workspaceUpdateInput.parse({ workspaceId: 'f-1', city: null });
    expect(cleared.city).toBeNull();
    const untouched = workspaceUpdateInput.parse({ workspaceId: 'f-1', name: 'Northwind' });
    expect(untouched).not.toHaveProperty('city');
  });

  /**
   * Audit A1. `legalName` was the one column from the registration migration
   * that never reached these schemas, so it could not be set through the
   * product at all.
   *
   * A zod object STRIPS unknown keys, so a future edit removing the field here
   * would drop it silently on the way to the service rather than fail to
   * compile. That is what these cases stand in front of.
   */
  describe('the statutory legalName is settable (audit A1)', () => {
    const LEGAL_NAME = 'Northwind Traders Limited';

    it('carries legalName through create, trimmed', () => {
      const parsed = workspaceCreateInput.parse({
        name: 'Northwind',
        legalName: `  ${LEGAL_NAME}  `,
      });
      expect(parsed.legalName).toBe(LEGAL_NAME);
    });

    it('carries legalName through update, and clears it with null', () => {
      expect(
        workspaceUpdateInput.parse({ workspaceId: 'f-1', legalName: LEGAL_NAME }).legalName,
      ).toBe(LEGAL_NAME);
      expect(
        workspaceUpdateInput.parse({ workspaceId: 'f-1', legalName: null }).legalName,
      ).toBeNull();
      expect(
        workspaceUpdateInput.parse({ workspaceId: 'f-1', name: 'Northwind' }),
      ).not.toHaveProperty('legalName');
    });

    it('stays optional: a client can be recorded before its paperwork arrives', () => {
      // Deliberate. The DB column is nullable and existing rows hold null, so a
      // required field would make every pre-existing Workspace uneditable. Filing,
      // not this schema, is where the absence bites.
      expect(workspaceCreateInput.parse({ name: 'Northwind' })).not.toHaveProperty('legalName');
    });

    it('rejects a blank or whitespace-only legalName rather than storing one', () => {
      // A blank would pass the NOT NULL backstop and still fail filing, which
      // trims before checking. Reject it at the door instead.
      expect(workspaceCreateInput.safeParse({ name: 'Northwind', legalName: '' }).success).toBe(
        false,
      );
      expect(workspaceCreateInput.safeParse({ name: 'Northwind', legalName: '   ' }).success).toBe(
        false,
      );
    });

    it('allows the full registered form, longer than the working label', () => {
      expect(
        workspaceCreateInput.safeParse({ name: 'Northwind', legalName: 'x'.repeat(300) }).success,
      ).toBe(true);
      expect(
        workspaceCreateInput.safeParse({ name: 'Northwind', legalName: 'x'.repeat(301) }).success,
      ).toBe(false);
    });
  });
});
