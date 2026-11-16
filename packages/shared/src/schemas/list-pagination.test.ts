import { describe, expect, it } from 'vitest';
import { auditLogListOutput } from './audit';
import { adminUserListPageOutput } from './user';

/**
 * The pagination contract the list screens are built on, asserted across the
 * files it is spread over.
 *
 * Every list surface pages by keyset cursor. The cursor is what traverses, and
 * it knows only whether a NEXT page exists - never how many there are. So a
 * footer that says "Showing 1-10 of 135" needs a second number, and these
 * are the contracts that carry it.
 *
 * They carry it ON THE FIRST PAGE ONLY. A COUNT over one traversal's predicate
 * answers the same number on every page of that traversal, so paying for it per
 * page bought a footer that had not changed; the request without a `cursor` is
 * the one that counts, and the client carries the answer forward. `total` is
 * therefore nullable on all four, and null is what a cursored page sends.
 *
 * One of them deliberately carries no total at all, which is why this file
 * exists rather than a line in each schema's own test: the interesting fact is
 * the DIVISION, and a division stated in five places is a division nobody can
 * see.
 */

/** Every list output that gained a total, named by the screen that renders it. */
const WITH_TOTAL = [['user.listUsers (settings members)', adminUserListPageOutput]] as const;

describe('paginated list contracts', () => {
  it.each(WITH_TOTAL)('%s carries both the cursor and the total', (_screen, schema) => {
    const keys = Object.keys(schema.shape);
    expect(keys).toContain('items');
    // BOTH, not either. Dropping the cursor for offset paging is what makes
    // deep pages slow; dropping the total is what makes the footer unable to
    // draw page buttons at all.
    expect(keys).toContain('nextCursor');
    expect(keys).toContain('total');
  });

  it.each(WITH_TOTAL)('%s rejects a negative or fractional total', (_screen, schema) => {
    const shape = schema.shape as {
      total: { safeParse: (value: unknown) => { success: boolean } };
    };
    expect(shape.total.safeParse(0).success).toBe(true);
    expect(shape.total.safeParse(135).success).toBe(true);
    expect(shape.total.safeParse(-1).success).toBe(false);
    expect(shape.total.safeParse(1.5).success).toBe(false);
  });

  /**
   * The half of the contract the client has to know about. A cursored page
   * sends null, not a stale echo and not the number again, so a screen that
   * forgets to carry the first page's answer renders a footer with no total
   * rather than one the server did not vouch for.
   */
  it.each(WITH_TOTAL)('%s accepts null, for a page cut from a cursor', (_screen, schema) => {
    const shape = schema.shape as {
      total: { safeParse: (value: unknown) => { success: boolean } };
    };
    expect(shape.total.safeParse(null).success).toBe(true);
    // Not undefined: null is the wire value, and an absent key would make
    // "counted zero" and "did not count" the same observation on the client.
    expect(shape.total.safeParse(undefined).success).toBe(false);
  });

  /**
   * The one refusal, pinned so it cannot be "fixed" by someone matching the
   * shape of its neighbors. `AuditLog` is the app's only unbounded
   * cross-tenant table and its visibility predicate is an OR arm that joins
   * `User` over every tenant's pre-auth rows. The page read escapes both
   * because `take: limit + 1` stops
   * early; a COUNT cannot. Adding a total here means adding indexes and a
   * measurement first - see the docblock on `auditLogListOutput`.
   */
  it('audit.list refuses a total rather than paying for one', () => {
    const keys = Object.keys(auditLogListOutput.shape);
    expect(keys).toContain('nextCursor');
    expect(keys).not.toContain('total');
  });
});
