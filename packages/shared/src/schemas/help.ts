import { z } from 'zod';

/**
 * Guided-tour progress: the wire contract between the `help` router and the
 * web `features/help` layer.
 *
 * THE SERVER DOES NOT KNOW WHICH TOURS EXIST. A tour is a client-side registry
 * entry (`apps/web/src/features/help/Help.tours.ts`), so the only thing that
 * crosses the wire is the id the client hands over. That is what makes the
 * ninth tour a registry line rather than a migration, and it is also why every
 * read here has to be tolerant: an id that was renamed or removed is still in
 * somebody's stored blob, and a READ MUST NEVER FAIL on a value an older
 * version wrote. `tourProgressMapSchema` therefore drops entries it cannot
 * parse instead of rejecting the whole map, and the client ignores ids its
 * registry no longer knows.
 */

/**
 * The shape of a tour id on the wire. Bounded and kebab-cased so an id can be
 * used verbatim as a Json object key, a translation-key segment and a DOM id
 * without escaping, and so a client cannot grow the stored blob with arbitrary
 * text.
 */
export const tourIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'A tour id is lowercase kebab-case.');

export type TourId = z.infer<typeof tourIdSchema>;

/**
 * How many tours one user's blob may hold. Not a product limit (there will
 * never be 200 screens); it is the bound that stops a compromised or buggy
 * client turning a Json column into unbounded storage. On overflow the service
 * drops the OLDEST entries, so the tours a person has seen most recently (the
 * ones whose "do not auto-start this again" answer still matters) survive.
 */
/*
 * Moved to `@repo/shared/constants` (no zod there), so the web pays for a
 * number instead of for the whole schemas chunk. Re-exported because the api
 * reads these from the module that enforces them.
 */
export { TOUR_PROGRESS_MAX_ENTRIES } from '../constants/index.js';

/**
 * One tour's record.
 *
 * `dismissed` distinguishes "walked to the end" from "closed halfway", and both
 * suppress the auto-start: the user has answered the question either way, and
 * re-offering a tour somebody closed is the exact irritation this feature is
 * meant to avoid. It is kept apart from `completedAt` because the settings list
 * reports the two differently.
 *
 * `version` is the tour's authored version at the moment it was seen. Nothing
 * reads it to re-offer a tour today (the decision on record is not to
 * re-interrupt everyone for a copy tweak); it is stored so that decision can be
 * revisited without a backfill.
 */
export const tourProgressEntrySchema = z.object({
  completedAt: z.iso.datetime(),
  version: z.number().int().min(0).max(1_000_000),
  dismissed: z.boolean(),
});

export type TourProgressEntry = z.infer<typeof tourProgressEntrySchema>;

/**
 * The stored map, parsed tolerantly.
 *
 * `z.record` with a `.catch(undefined)` value would keep the bad keys with an
 * undefined value, so the drop happens in the transform instead: anything whose
 * key is not a tour id or whose value is not an entry simply does not survive
 * the parse. The map as a whole always parses, which is the property that
 * matters: a single legacy entry must not take the user's whole read down.
 */
export const tourProgressMapSchema = z
  .unknown()
  .transform((raw): Record<string, TourProgressEntry> => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    const entries: Array<[string, TourProgressEntry]> = [];
    for (const [key, value] of Object.entries(raw)) {
      const id = tourIdSchema.safeParse(key);
      const entry = tourProgressEntrySchema.safeParse(value);
      if (id.success && entry.success) entries.push([id.data, entry.data]);
    }
    return Object.fromEntries(entries);
  });

export type TourProgressMap = Record<string, TourProgressEntry>;

/**
 * `help.progressGet` output. `updatedAt` is null while no row exists, which is
 * the same "never touched" signal `notificationPreferences.isDefault` carries.
 */
export const tourProgressOutput = z.object({
  tours: z.record(tourIdSchema, tourProgressEntrySchema),
  updatedAt: z.string().nullable(),
});

export type TourProgressOutput = z.infer<typeof tourProgressOutput>;

/**
 * `help.progressSave` input: ONE tour's outcome, not the whole map.
 *
 * Deliberately narrower than the notification-preferences matrix, which
 * round-trips wholesale. Two tabs finishing two different tours is an ordinary
 * thing to do, and a whole-map write would have the second one silently erase
 * the first. A single-entry merge makes concurrent writes commutative.
 */
export const tourProgressSaveInput = z.object({
  tourId: tourIdSchema,
  version: z.number().int().min(0).max(1_000_000),
  dismissed: z.boolean(),
});

export type TourProgressSaveInput = z.infer<typeof tourProgressSaveInput>;
