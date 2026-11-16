import { Injectable } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../common/database/prisma.service';
import { getRequestContext, getRequestId } from '../../common/context/request-context';
import { createAppLogger } from '../logger/logger.service';

const logger = createAppLogger('AuditService');

export interface IAuditLogParams {
  /** Dotted action name, e.g. `auth.login.success`, `invoice.approved`. */
  action: string;
  /** When omitted, taken from the ALS request context (set by auth middleware). */
  userId?: string | null;
  /** Logical kind of the resource that was acted on (e.g. `User`, `Invoice`). */
  targetType?: string;
  /** Primary key of the resource that was acted on. */
  targetId?: string;
  /** Snapshot before the change (compliance: who changed what to what). */
  before?: Record<string, unknown>;
  /** Snapshot after the change. */
  after?: Record<string, unknown>;
  /** Free-text justification, for sensitive admin actions, etc. */
  reason?: string;
  /** When omitted, taken from the ALS request context. */
  ipAddress?: string;
  /** When omitted, taken from the ALS request context. */
  userAgent?: string;
  /** False for failed-but-noteworthy attempts, e.g. login with bad password. */
  success?: boolean;
  /** Free-form metadata. Avoid putting PII here unless required. */
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Append an audit log entry. Never throws: audit failures must not break
   * the user-facing operation. If the DB is down we lose the entry; the
   * application keeps going and stderr/Sentry catches it.
   *
   * `userId` may be null for system events (cron jobs, scheduler-driven
   * cleanups, webhook handlers). The schema FK uses `SetNull` so a user
   * delete does not orphan-block their trail.
   */
  async log(params: IAuditLogParams): Promise<void> {
    try {
      await this.write(params);
    } catch (error) {
      // Swallow by design (the business op must not block), but make the loss
      // observable: an error log plus a Sentry event per failed write.
      logger.error('Failed to write audit log', { action: params.action }, error);
      Sentry.captureException(error, {
        extra: {
          action: params.action,
          requestId: getRequestId(),
        },
      });
    }
  }

  /**
   * Append an audit entry and PROPAGATE failure instead of swallowing it.
   *
   * For the handful of actions where the audit row IS the control (PII access
   * trails whose spec traded re-authentication for "every access leaves a
   * trace"), the swallow above is fail-open: the protected value would be
   * released while the only evidence of the access was lost. Callers of this
   * variant await the row BEFORE releasing the value, so an audit-write
   * failure turns the operation into an error rather than an untrailed
   * disclosure. Everything else should keep using log(): most audited
   * operations leave their own DB evidence and must not fail on a lost row.
   */
  async logOrThrow(params: IAuditLogParams): Promise<void> {
    await this.write(params);
  }

  private async write(params: IAuditLogParams): Promise<void> {
    const ctx = getRequestContext();
    const requestId = getRequestId();

    const userId = params.userId ?? ctx?.userId ?? null;

    const data: Record<string, unknown> = {
      userId,
      action: params.action,
      targetType: params.targetType ?? null,
      targetId: params.targetId ?? null,
      reason: params.reason ?? null,
      ipAddress: params.ipAddress ?? ctx?.ip ?? null,
      userAgent: params.userAgent ?? ctx?.userAgent ?? null,
      correlationId: requestId === 'no-context' ? null : requestId,
      success: params.success ?? true,
    };
    if (params.before !== undefined) data.before = params.before;
    if (params.after !== undefined) data.after = params.after;
    if (params.metadata !== undefined) data.metadata = params.metadata;

    await this.prismaService.client.auditLog.create({
      // Cast through unknown: the dynamic data shape above is narrowed at
      // runtime; at type level, Prisma's `exactOptionalPropertyTypes` mode
      // rejects `undefined` for nullable JSON fields.
      data: data as never,
    });
  }
}
