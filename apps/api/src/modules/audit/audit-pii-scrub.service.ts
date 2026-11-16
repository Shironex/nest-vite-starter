import { Injectable } from '@nestjs/common';
import type { Prisma } from '@repo/database' with { 'resolution-mode': 'import' };
import { AUDIT_PII_ERASED_VALUE, AUDIT_PII_FIELDS } from '@repo/shared/audit';
import { PrismaService } from '../../common/database/prisma.service';

/** Rows read per page while scrubbing one user's trail. */
export const AUDIT_PII_SCRUB_BATCH_SIZE = 500;

/**
 * The audit columns a registered key can sit in. Must equal the payload keys
 * `observability/audit-pii-declared` inspects (its default, which the lint
 * config does not override); audit-pii-registry.parity.spec.ts pins that.
 */
export const AUDIT_PII_PAYLOAD_COLUMNS = ['metadata', 'before', 'after'] as const;
type PayloadColumn = (typeof AUDIT_PII_PAYLOAD_COLUMNS)[number];

const REGISTERED: ReadonlySet<string> = new Set(AUDIT_PII_FIELDS);

/**
 * Return `value` with every registered key, at any depth, overwritten by the
 * erased marker, or `undefined` when nothing in it needed erasing (so the caller
 * can skip the write). Pure and idempotent: a value already erased is left
 * alone, which is what makes a retried purge a no-op on rows it already did.
 */
export function eraseRegisteredPii(value: unknown): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((element: unknown) => {
      const erased = eraseRegisteredPii(element);
      if (erased === undefined) {
        return element;
      }
      changed = true;
      return erased;
    });
    return changed ? next : undefined;
  }
  if (value === null || typeof value !== 'object') {
    return undefined;
  }
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (REGISTERED.has(key) && child !== null && child !== AUDIT_PII_ERASED_VALUE) {
      next[key] = AUDIT_PII_ERASED_VALUE;
      changed = true;
      continue;
    }
    const erased = eraseRegisteredPii(child);
    if (erased === undefined) {
      next[key] = child;
    } else {
      next[key] = erased;
      changed = true;
    }
  }
  return changed ? next : undefined;
}

/**
 * The erasure half of the SCRUB ON PURGE policy for audit rows (see
 * AUDIT_PII_FIELDS in @repo/shared/audit, the registry this reads).
 *
 * Anonymizes, never deletes: the row, its action, timestamps, ids and every
 * unregistered key survive. Only the values under registered keys become the
 * erased marker.
 *
 * WHICH ROWS. Every row the user is the SUBJECT of (`targetType: 'User'`,
 * `targetId`) or the ACTOR of (`userId`). The subject arm is the one the
 * registry's own entries live in (the email-change rows name the user as both).
 * The actor arm is there because a registered key the user wrote about
 * themselves on a row targeting something else would otherwise outlive them;
 * its cost is that a registered key holding a DIFFERENT person's data on such a
 * row is erased too. Over-erasing a living person's address from an old trail is
 * the recoverable direction; keeping a purged person's is not.
 *
 * ACROSS TENANTS, by design, which is why this file sits in
 * TENANT_WHERE_ALLOW_IN (packages/eslint-config/nestjs.js). A user's rows can
 * carry a null tenantId (pre-auth writes) or a PREVIOUS organization's (an
 * account that moved between tenants), so a tenantId filter would
 * silently leave rows unscrubbed. The keys it filters on are the purged user's
 * own id, which the purge read from the row it is erasing, never caller input.
 *
 * MUST RUN BEFORE the user row is deleted: AuditLog.userId is `SetNull`, so
 * after the delete the actor arm no longer finds anything.
 *
 * Throws on failure (unlike AuditService.log): the purge treats a failed scrub
 * as a reason to keep the user row and retry next tick.
 */
@Injectable()
export class AuditPiiScrubService {
  constructor(private readonly prismaService: PrismaService) {}

  /** Erase registered PII from every audit row of `userId`; returns rows rewritten. */
  async scrubUser(userId: string): Promise<number> {
    let rewritten = 0;
    let afterId: string | undefined;

    // Keyset paging on id: a rewrite does not move a row, so a page boundary
    // never skips or repeats one, however many rows the user has.
    for (;;) {
      const rows = await this.prismaService.client.auditLog.findMany({
        where: {
          OR: [{ userId }, { targetType: 'User', targetId: userId }],
          ...(afterId === undefined ? {} : { id: { gt: afterId } }),
        },
        select: { id: true, metadata: true, before: true, after: true },
        orderBy: { id: 'asc' },
        take: AUDIT_PII_SCRUB_BATCH_SIZE,
      });

      for (const row of rows) {
        const data: Partial<Record<PayloadColumn, Prisma.InputJsonValue>> = {};
        for (const column of AUDIT_PII_PAYLOAD_COLUMNS) {
          const erased = eraseRegisteredPii(row[column]);
          if (erased !== undefined) {
            data[column] = erased as Prisma.InputJsonValue;
          }
        }
        if (Object.keys(data).length === 0) {
          continue;
        }
        await this.prismaService.client.auditLog.update({ where: { id: row.id }, data });
        rewritten += 1;
      }

      const last = rows.at(-1);
      if (last === undefined || rows.length < AUDIT_PII_SCRUB_BATCH_SIZE) {
        return rewritten;
      }
      afterId = last.id;
    }
  }
}
