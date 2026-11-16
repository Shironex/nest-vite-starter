import type { IAuditRowView } from '../../Audit.types';

export interface IAuditLogDetailsProps {
  readonly row: IAuditRowView;
}

export interface IAuditLogDetailsView {
  readonly labels: {
    readonly changes: string;
    readonly changedFields: string;
    readonly metadata: string;
    readonly reason: string;
    readonly target: string;
    readonly ip: string;
    readonly userAgent: string;
    readonly correlationId: string;
    readonly noDetails: string;
  };
}
