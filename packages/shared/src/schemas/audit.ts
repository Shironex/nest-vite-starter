import { z } from 'zod';

/**
 * Audit-log read schemas for the admin audit list.
 *
 * Read-only wire contract over the append-only AuditLog table. There is no
 * write input here on purpose: rows are only ever written server-side through
 * AuditService, and the sole sanctioned delete path is the retention cron.
 *
 * The list is deliberately lean: newest first, one keyset page at a time, no
 * filters, no search and no export. A fork that needs inspection tooling adds
 * filters here and in AuditReadRepository.
 */

/*
 * The page bounds live in `@repo/shared/constants`, which carries no zod, so
 * the web pays for a number instead of for the whole schemas chunk.
 * Re-exported here because the api reads them from the module that enforces
 * them.
 */
export { AUDIT_LOG_LIST_DEFAULT_LIMIT, AUDIT_LOG_LIST_MAX_LIMIT } from '../constants/index.js';
import { AUDIT_LOG_LIST_DEFAULT_LIMIT, AUDIT_LOG_LIST_MAX_LIMIT } from '../constants/index.js';

export const auditLogListInput = z
  .object({
    cursor: z.string().optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(AUDIT_LOG_LIST_MAX_LIMIT)
      .default(AUDIT_LOG_LIST_DEFAULT_LIMIT),
  })
  // prefault (not default): the fallback {} is parsed through the object
  // schema, so the inner limit default applies (same pattern as listUsers).
  .prefault({});
export type AuditLogListInput = z.infer<typeof auditLogListInput>;

/**
 * The actor projection. Nullable as a whole: system events (crons, workers)
 * have no user, and a purged user's rows keep their trail with the FK nulled.
 */
const auditActorSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    displayName: z.string().nullable(),
  })
  .nullable();

/**
 * One row as the list shows it. Snapshots, metadata, IP address and user agent
 * stay in the table and off the wire: the list renders who, what, on which
 * target and when, and a column nobody renders is exposure for nothing.
 */
const auditLogItemSchema = z.object({
  id: z.string(),
  /**
   * Plain string, not an enum of AUDIT_ACTIONS: a row written by a newer
   * server (or before a rename) must still render, not fail the output parse
   * of the very list built to show history.
   */
  action: z.string(),
  actor: auditActorSchema,
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  success: z.boolean(),
  createdAt: z.date(),
});
export type AuditLogItem = z.infer<typeof auditLogItemSchema>;

/**
 * NO `total`, deliberately. `AuditLog` is the app's only append-only,
 * unbounded table, and a COUNT has no early exit, while the page read stops
 * as soon as `take: limit + 1` has enough rows. The footer renders
 * "Showing 1-25" with prev/next and no page numbers.
 */
export const auditLogListOutput = z.object({
  items: z.array(auditLogItemSchema),
  nextCursor: z.string().nullable(),
});
export type AuditLogListOutput = z.infer<typeof auditLogListOutput>;
