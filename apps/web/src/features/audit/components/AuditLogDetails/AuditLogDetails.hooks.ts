import type { IAuditLogDetailsView } from './AuditLogDetails.types';
import { auditStrings } from '@/features/audit/Audit.strings';

export function useAuditLogDetails(): IAuditLogDetailsView {
  return {
    labels: {
      changes: auditStrings.details.changes,
      changedFields: auditStrings.details.changedFields,
      metadata: auditStrings.details.metadata,
      reason: auditStrings.details.reason,
      target: auditStrings.details.target,
      ip: auditStrings.details.ip,
      userAgent: auditStrings.details.userAgent,
      correlationId: auditStrings.details.correlationId,
      noDetails: auditStrings.details.noDetails,
    },
  };
}
