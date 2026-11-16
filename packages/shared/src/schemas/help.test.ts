import { describe, expect, it } from 'vitest';
import {
  tourIdSchema,
  tourProgressEntrySchema,
  tourProgressMapSchema,
  tourProgressSaveInput,
} from './help.js';

const ENTRY = { completedAt: '2026-08-28T10:00:00.000Z', version: 1, dismissed: false };

describe('tourIdSchema', () => {
  it.each(['members', 'audit-board', 'a', 'a1-b2'])('accepts %s', (id) => {
    expect(tourIdSchema.safeParse(id).success).toBe(true);
  });

  it.each(['Members', 'audit_board', '-leading', 'trailing-', 'two--dashes', ''])(
    'refuses %s',
    (id) => {
      expect(tourIdSchema.safeParse(id).success).toBe(false);
    },
  );

  it('refuses an id long enough to grow the stored blob', () => {
    expect(tourIdSchema.safeParse('a'.repeat(65)).success).toBe(false);
  });
});

describe('tourProgressMapSchema', () => {
  it('keeps a well-formed entry', () => {
    expect(tourProgressMapSchema.parse({ members: ENTRY })).toEqual({ members: ENTRY });
  });

  /**
   * The rule this feature actually rests on: a tour id
   * that no longer exists in the registry, or an entry an older version wrote
   * in a different shape, must be DROPPED rather than take the whole read down
   * with it. A user who cannot read their tour progress cannot use the app's
   * help at all, and they would have no idea why.
   */
  it('drops an entry whose value is malformed without failing the read', () => {
    const parsed = tourProgressMapSchema.parse({
      members: ENTRY,
      audit: { completedAt: 'not-a-date', version: 1, dismissed: false },
      legacy: 'true',
      missingFields: { version: 1 },
    });

    expect(parsed).toEqual({ members: ENTRY });
  });

  it('drops a key that is not a tour id without failing the read', () => {
    const parsed = tourProgressMapSchema.parse({ 'Not A Tour Id': ENTRY, members: ENTRY });

    expect(parsed).toEqual({ members: ENTRY });
  });

  /**
   * A tour that was renamed or removed leaves a perfectly well-formed entry
   * behind. It survives the parse on purpose (the server has no registry to
   * check it against), and the CLIENT ignores it, which is asserted over in
   * `Help.tours.test.ts`.
   */
  it('keeps a well-formed entry for a tour the registry no longer knows', () => {
    expect(tourProgressMapSchema.parse({ 'retired-screen': ENTRY })).toEqual({
      'retired-screen': ENTRY,
    });
  });

  it.each([[null], [undefined], ['a string'], [[ENTRY]], [42]])(
    'reads %s as an empty map rather than throwing',
    (stored) => {
      expect(tourProgressMapSchema.parse(stored)).toEqual({});
    },
  );
});

describe('tourProgressEntrySchema', () => {
  it('refuses a negative version', () => {
    expect(tourProgressEntrySchema.safeParse({ ...ENTRY, version: -1 }).success).toBe(false);
  });
});

describe('tourProgressSaveInput', () => {
  it('takes one tour at a time, so two tabs finishing two tours cannot erase each other', () => {
    expect(tourProgressSaveInput.parse({ tourId: 'members', version: 2, dismissed: true })).toEqual(
      { tourId: 'members', version: 2, dismissed: true },
    );
  });

  it('refuses an unknown-shaped id', () => {
    expect(
      tourProgressSaveInput.safeParse({ tourId: 'Members!', version: 1, dismissed: false }).success,
    ).toBe(false);
  });
});
