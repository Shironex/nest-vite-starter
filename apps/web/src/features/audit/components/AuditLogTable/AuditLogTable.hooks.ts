import { useState } from 'react';
import { useTranslation } from 'react-i18next';
// Side effect: attaches this feature's catalogs before the first t() call, so
// a hook rendered in isolation (a *.hooks.test.tsx) has the copy too.
import '../../Audit.i18n';
import type { IAuditLogTableView } from './AuditLogTable.types';

/**
 * Row-expansion state for the feed. A Set rather than a single id: comparing
 * two events side by side (one reveal against the edit that preceded it) is
 * exactly how the screen gets used during an inspection.
 */
export function useAuditLogTable(): IAuditLogTableView {
  const { t } = useTranslation('audit');
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
      actor: t('list.columns.actor'),
      action: t('list.columns.action'),
      details: t('list.columns.details'),
      when: t('list.columns.when'),
      expand: t('list.expand'),
      collapse: t('list.collapse'),
      previous: t('pagination.previous', { ns: 'common' }),
      next: t('pagination.next', { ns: 'common' }),
    },
  };
}
