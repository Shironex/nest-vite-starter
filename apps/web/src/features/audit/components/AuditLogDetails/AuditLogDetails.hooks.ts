import { useTranslation } from 'react-i18next';
// Side effect: attaches this feature's catalogs before the first t() call, so
// a hook rendered in isolation (a *.hooks.test.tsx) has the copy too.
import '../../Audit.i18n';
import type { IAuditLogDetailsView } from './AuditLogDetails.types';

export function useAuditLogDetails(): IAuditLogDetailsView {
  const { t } = useTranslation('audit');

  return {
    labels: {
      changes: t('details.changes'),
      changedFields: t('details.changedFields'),
      metadata: t('details.metadata'),
      reason: t('details.reason'),
      target: t('details.target'),
      ip: t('details.ip'),
      userAgent: t('details.userAgent'),
      correlationId: t('details.correlationId'),
      noDetails: t('details.noDetails'),
    },
  };
}
