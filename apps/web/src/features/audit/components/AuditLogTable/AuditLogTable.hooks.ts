import { useState } from 'react';
import type { IAuditLogTableView } from './AuditLogTable.types';
import { auditStrings } from '@/features/audit/Audit.strings';
import { commonStrings } from '@/lib/strings';

/**
 * Row-expansion state for the feed. A Set rather than a single id: comparing
 * two events side by side (one reveal against the edit that preceded it) is
 * exactly how the screen gets used during an inspection.
 */
export function useAuditLogTable(): IAuditLogTableView {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());

  const onToggle = (id: string): void => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return {
    isExpanded: (id) => expandedIds.has(id),
    onToggle,
    labels: {
      actor: auditStrings.list.columns.actor,
      action: auditStrings.list.columns.action,
      details: auditStrings.list.columns.details,
      when: auditStrings.list.columns.when,
      expand: auditStrings.list.expand,
      collapse: auditStrings.list.collapse,
      previous: commonStrings.pagination.previous,
      next: commonStrings.pagination.next,
    },
  };
}
