import type { IComboboxOption } from '@repo/ui/combobox';
import {
  AUDIT_ACTION_GROUPS,
  auditActionGroupLabel,
  auditActionLabel,
} from '../../Audit.constants';
import { useAuditActorOptions } from '../../Audit.queries';
import type { IAuditLogFiltersProps, IAuditLogFiltersView } from './AuditLogFilters.types';
import { commonStrings } from '@/lib/strings';
import { auditStrings } from '@/features/audit/Audit.strings';

/**
 * The audit trail's narrowing, behind the toolbar's "Filtry" control.
 *
 * EVERY PICKER IS A COMBOBOX NOW. The event type is dozens of options in
 * several sections and was the worst unsearchable dropdown in the product; the
 * people lists are unbounded by construction. A `Select` is for an enum a
 * user reads at a glance, and none of these is that. The group each event type
 * files under rides on the option rather than needing a separate composition
 * step, which is why the whole 74 collapses to one flat array here.
 *
 * `null` rather than an `ALL` sentinel: Radix Select refuses an empty item
 * value and so needed one, but `Combobox` takes `clearLabel` and models "no
 * filter" as the absence of a value. The '' at the props boundary stays, so the
 * page's filter state is unchanged.
 */
export function useAuditLogFilters(props: IAuditLogFiltersProps): IAuditLogFiltersView {
  const actorsQuery = useAuditActorOptions();

  const actorOptions: IComboboxOption[] = (actorsQuery.data?.items ?? []).map((user) => ({
    value: user.id,
    label: user.displayName ?? user.email,
  }));

  const actionOptions: IComboboxOption[] = AUDIT_ACTION_GROUPS.flatMap((group) =>
    group.actions.map((action) => ({
      value: action,
      label: auditActionLabel(action),
      group: auditActionGroupLabel(group.key),
    })),
  );

  return {
    actorValue: props.actorId === '' ? null : props.actorId,
    actionValue: props.action === '' ? null : props.action,
    actorOptions,
    actionOptions,
    isActorsLoading: actorsQuery.isPending,
    onActorValueChange: (value) => props.onActorChange(value ?? ''),
    onActionValueChange: (value) => props.onActionChange(value ?? ''),
    // The date field hands over a `yyyy-MM-dd` string rather than a change
    // event, so there is nothing left to unwrap.
    onFromInput: props.onFromChange,
    onToInput: props.onToChange,
    labels: {
      trigger: commonStrings.list.filters,
      heading: commonStrings.list.filtersHeading,
      activeCount: commonStrings.list.filtersActive(props.activeFilters),
      actor: auditStrings.filters.actor,
      actorAll: auditStrings.filters.actorAll,
      eventType: auditStrings.filters.eventType,
      eventTypeAll: auditStrings.filters.eventTypeAll,
      search: commonStrings.actions.search,
      noMatch: auditStrings.filters.noMatch,
      loading: commonStrings.states.loading,
      from: auditStrings.filters.from,
      to: auditStrings.filters.to,
      clear: auditStrings.filters.clear,
    },
  };
}
