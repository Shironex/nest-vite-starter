import { z } from 'zod';
import { AUDIT_ACTIONS, type AuditAction } from '../audit/index.js';

/**
 * Audit-log read schemas for the "Audit log" screen.
 *
 * Read-only wire contract over the append-only AuditLog table. There is no
 * write input here on purpose: rows are only ever written server-side through
 * AuditService, and the sole sanctioned delete path is the retention cron.
 */

/*
 * The four bounds this module enforces now live in `@repo/shared/constants`,
 * which carries no zod, so the web pays for a number instead of for the whole
 * schemas chunk. Re-exported here because the api reads them from the module
 * that enforces them.
 */
export {
  AUDIT_LOG_LIST_DEFAULT_LIMIT,
  AUDIT_LOG_LIST_MAX_LIMIT,
  AUDIT_LOG_MAX_RANGE_DAYS,
  AUDIT_LOG_MAX_ACTIONS,
} from '../constants/index.js';
import {
  AUDIT_LOG_LIST_DEFAULT_LIMIT,
  AUDIT_LOG_LIST_MAX_LIMIT,
  AUDIT_LOG_MAX_RANGE_DAYS,
  AUDIT_LOG_MAX_ACTIONS,
} from '../constants/index.js';

/**
 * The canonical action vocabulary as a zod enum, for FILTER INPUTS only. List
 * OUTPUTS deliberately carry `action` as a plain string instead: a row written
 * by a newer server (or before a rename) must still render, not fail the
 * output parse of the very screen built to inspect history.
 */
export const auditActionSchema = z.enum(
  Object.values(AUDIT_ACTIONS) as [AuditAction, ...AuditAction[]],
);

/**
 * The filters the audit list narrows by. Deliberately NO free-text search:
 * over a table this size an unindexed substring match is a trap, and every
 * question the screen answers ("who changed this record", "which logins
 * failed last week") is expressible as a structured filter.
 */
const auditLogFilterFields = {
  /** Actor: the user who performed the action. */
  actorId: z.string().optional(),
  /**
   * Event types to include (OR). One array covers both the single-select
   * ("event type" dropdown) and the quick filters, which OR several related
   * actions (e.g. every failed-login flavor) in one click.
   */
  actions: z.array(auditActionSchema).min(1).max(AUDIT_LOG_MAX_ACTIONS).optional(),
  /** Inclusive range start. */
  from: z.date().optional(),
  /** Inclusive range end. */
  to: z.date().optional(),
};

export const auditLogListInput = z
  .object({
    ...auditLogFilterFields,
    cursor: z.string().optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(AUDIT_LOG_LIST_MAX_LIMIT)
      .default(AUDIT_LOG_LIST_DEFAULT_LIMIT),
  })
  .refine((input) => !input.from || !input.to || input.to >= input.from, {
    message: 'Range end cannot precede its start.',
    path: ['to'],
  })
  .refine(
    (input) =>
      !input.from ||
      !input.to ||
      input.to.getTime() - input.from.getTime() <= AUDIT_LOG_MAX_RANGE_DAYS * 24 * 60 * 60 * 1000,
    { message: 'Audit range is limited to 400 days.', path: ['to'] },
  )
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

const auditLogItemSchema = z.object({
  id: z.string(),
  /** Plain string on purpose; see auditActionSchema. */
  action: z.string(),
  actor: auditActorSchema,
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  /**
   * Snapshots and metadata are free-form JSON columns; `unknown` keeps the
   * output parse from rejecting any historical shape. The client narrows with
   * a record type-guard before rendering a field diff.
   */
  before: z.unknown(),
  after: z.unknown(),
  metadata: z.unknown(),
  reason: z.string().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  correlationId: z.string().nullable(),
  success: z.boolean(),
  createdAt: z.date(),
});
export type AuditLogItem = z.infer<typeof auditLogItemSchema>;

/**
 * NO `total`, deliberately, and this is the one list contract in the app that
 * refuses one.
 *
 * Every other list surface gained a `total` so its footer can render numbered
 * pages. This one cannot afford the COUNT, for three compounding reasons that
 * live in `AuditReadRepository.listPage` and `audit.prisma`:
 *
 *   1. `AuditLog` is the app's only append-only, cross-tenant, unbounded table.
 *      It takes a row for every mutation, every login attempt and every cron
 *      tick of every organization, and the retention sweep only trims it at
 *      AUDIT_LOG_RETENTION_DAYS (365 by default).
 *   2. The visibility predicate is an OR whose second arm is
 *      `tenantId IS NULL AND user.tenantId = <caller>`. That arm spans EVERY
 *      tenant's pre-auth rows and joins `User` to attribute them, so no index on
 *      `AuditLog` can serve it. There is no `(tenantId, createdAt)` index
 *      either: the only tenantId-leading one is
 *      `(tenantId, workspaceId, targetType, targetId)`, which a date-range count
 *      cannot use.
 *
 * The PAGE read escapes all of that because `take: limit + 1` on the
 * `createdAt desc, id desc` order stops as soon as it has enough rows. A COUNT
 * has no early exit and must walk the whole matched set.
 *
 * So the Audit log footer renders "Showing 1-25" with prev/next and no
 * page numbers. A degraded footer is the honest answer; a total this screen
 * cannot compute correctly would be a slower screen telling a worse lie.
 */
export const auditLogListOutput = z.object({
  items: z.array(auditLogItemSchema),
  nextCursor: z.string().nullable(),
});
export type AuditLogListOutput = z.infer<typeof auditLogListOutput>;
