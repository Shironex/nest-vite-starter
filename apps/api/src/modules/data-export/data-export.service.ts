import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { DATA_EXPORT_SCHEMA_VERSION } from '@repo/shared/schemas';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { UserService } from '../user/user.service';
import { AuditService } from '../audit/audit.service';
import { now } from '../../common/clock';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { enforceFixedWindowLimit } from '../../common/redis/rate-limit';

// Per-user fixed window. Generous for a legitimate "download my data" flow
// (once, maybe twice), tight enough that a scripted session cannot hammer
// what will become a heavy multi-section read in product forks.
const DATA_EXPORT_RATE_LIMIT = 5;
const DATA_EXPORT_RATE_WINDOW_SECONDS = 3600;

/**
 * Assembles the GDPR data-portability export for a single user.
 *
 * This is a PATTERN SKELETON. It demonstrates the auth-gated, owner-scoped,
 * output-stripped, single-read export shape so a product fork can fill in its
 * own domain sections.
 *
 * Ownership: the only argument is the `userId` the router pulls from the
 * authenticated session. There is no id taken from request input, so there is
 * no IDOR surface, a user can only ever export their own data.
 *
 * Scope: live data only. v1 returns just the account profile (via
 * `UserService.getProfile`, which never carries passwordHash). A richer fork
 * reads its sections in a single `prisma.$transaction([...])` for a consistent
 * snapshot and bounded pool use, then nests them under this same return shape.
 *
 * Secrets: every value rides the router's output-schema strip
 * (`output: userDataExportOutput`), the same wire-strip the rest of the app
 * trusts, which drops any internal column before the response leaves the
 * process. The ACCESS is audited (who exported, when, from where) as metadata
 * only; the export payload itself is never logged or audited.
 */
@Injectable()
export class DataExportService {
  constructor(
    private readonly userService: UserService,
    private readonly auditService: AuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // Return type is inferred; the wire contract is enforced at the router by
  // `output: userDataExportOutput`, which zod-parses and strips the result
  // before it leaves the server.
  async exportForUser(userId: string) {
    // Per-user limit (global ThrottlerGuard does not cover tRPC procedures).
    // Enforced before any read so a limited call does zero work.
    await enforceFixedWindowLimit(
      this.redis,
      `data-export:${userId}`,
      DATA_EXPORT_RATE_LIMIT,
      DATA_EXPORT_RATE_WINDOW_SECONDS,
    );

    // v1: account profile only. getProfile uses the canonical safe projection
    // (id, email, displayName, role, kind, emailVerified, createdAt)
    // and never loads passwordHash. A fork adds further sections here, read in one
    // transaction for a consistent snapshot.
    const account = await this.userService.getProfile(userId);

    // GDPR access event: metadata only (ip / userAgent / tenant ride the ALS
    // fallback inside AuditService). NEVER attach the export payload here.
    await this.auditService.log({
      action: AUDIT_ACTIONS.DATA_EXPORT_DOWNLOADED,
      userId,
      targetType: 'User',
      targetId: userId,
    });

    return {
      exportSchema: DATA_EXPORT_SCHEMA_VERSION,
      exportedAt: now(),
      account,
    };
  }
}
