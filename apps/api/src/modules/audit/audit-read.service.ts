import { Injectable } from '@nestjs/common';
import type { AuditLogListInput } from '@repo/shared/schemas';
import { ForbiddenError } from '../../common/errors';
import { getTenantId } from '../../common/context/request-context';
import { AuditReadRepository, type IAuditLogListPage } from './audit-read.repository';

/**
 * Read side of the audit trail (the "Audit log" screen). Kept apart from
 * AuditService on purpose: the writer must never throw into a business
 * operation, while a reader that cannot resolve its tenant must throw rather
 * than answer.
 */
@Injectable()
export class AuditReadService {
  constructor(private readonly auditReadRepository: AuditReadRepository) {}

  /**
   * One keyset page of the caller's tenant history. Tenant containment: the
   * `AuditLog` model is deliberately outside the tenant-scope extension, so
   * the tenant filter is explicit in the repository and the tenant id is
   * resolved HERE, from the ALS the auth middleware seeded. Fails closed: a
   * missing tenant in context throws Forbidden rather than returning every
   * organization's history.
   */
  async list(input: AuditLogListInput): Promise<IAuditLogListPage> {
    const tenantId = getTenantId();
    if (!tenantId) {
      throw new ForbiddenError();
    }

    return this.auditReadRepository.listPage(tenantId, input);
  }
}
