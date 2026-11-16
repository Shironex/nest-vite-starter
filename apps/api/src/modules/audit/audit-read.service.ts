import { Injectable } from '@nestjs/common';
import type { AuditLogListInput } from '@repo/shared/schemas';
import { AuditReadRepository, type IAuditLogListPage } from './audit-read.repository';

/**
 * Read side of the audit trail (the "Audit log" screen). Kept apart from
 * AuditService on purpose: the writer must never throw into a business
 * operation, while a reader may throw.
 */
@Injectable()
export class AuditReadService {
  constructor(private readonly auditReadRepository: AuditReadRepository) {}

  /** One keyset page of the audit trail. The router is admin-gated. */
  async list(input: AuditLogListInput): Promise<IAuditLogListPage> {
    return this.auditReadRepository.listPage(input);
  }
}
