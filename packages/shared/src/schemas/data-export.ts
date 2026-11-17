import { z } from 'zod';
import { userProfileOutput } from './user.js';

/**
 * User data export (GDPR Art. 20, data portability). The `dataExport.download`
 * procedure returns a machine-readable snapshot of the caller's own data so a
 * user can take it elsewhere or keep a copy.
 *
 * This is a PATTERN SKELETON. v1 carries only the user's account profile,
 * because that is the only user-owned data Nest Vite Starter ships so far. Each new domain
 * extends `userDataExportOutput` with its own sections (each composed
 * from the same strict `*Output` projections the rest of the app uses, so the
 * export inherits the wire-strip guarantee that keeps internal columns,
 * passwordHash / failedAttempts / soft-delete flags, off the wire).
 *
 * The output schema is set as the router `output:`, so the server zod-parses
 * and strips the result before it leaves the process: nothing internal can ride
 * along even if a future section returns a loose object.
 */

/**
 * Current export-format version, emitted as `exportSchema` at the top of every
 * export. Bump on a structural change so a future importer (or a user holding
 * an older file) can detect the format. Additive fields don't require a bump.
 */
export const DATA_EXPORT_SCHEMA_VERSION = 1 as const;

/**
 * `dataExport.download` output, the full export tree. `exportedAt` is the
 * instant the snapshot was assembled (superjson preserves it as a `Date`;
 * `JSON.stringify` on the client renders it as an ISO string in the downloaded
 * file). v1 carries `exportSchema`, `exportedAt`, and `account` only. The
 * account section is the same strict `userProfileOutput` projection `user.me`
 * uses (never passwordHash or the lockout counters).
 */
export const userDataExportOutput = z.object({
  exportSchema: z.literal(DATA_EXPORT_SCHEMA_VERSION),
  exportedAt: z.date(),
  account: userProfileOutput,
});

export type UserDataExport = z.infer<typeof userDataExportOutput>;
