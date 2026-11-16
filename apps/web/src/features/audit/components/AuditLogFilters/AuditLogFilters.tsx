import { Combobox } from '@repo/ui/combobox';
import { Label } from '@repo/ui/label';
import { DateField } from '@/features/shared/components/DateField';
import { ListFilterPopover } from '@/features/shared/components/ListFilterPopover';
// Side effect: registers this feature's catalogs. Needed HERE and not only in
// the hook file, because a component test mocks the hook module away, and
// without this import the panel would render bare i18n keys under test.
import '../../Audit.i18n';
import { useAuditLogFilters } from './AuditLogFilters.hooks';
import type { IAuditLogFiltersProps } from './AuditLogFilters.types';

/**
 * The audit trail's narrowing: who, about whom, what kind of event, and when.
 *
 * Every control lives behind the toolbar's one "Filtry" button, which is
 * where every other list in the app keeps its narrowing. The trail's two
 * highest-value slices are not here: they are the tab row, because "which
 * events am I looking at" is a place rather than a filter.
 */

const FIELD_CLASS = 'space-y-1.5';
const RANGE_CLASS = 'grid grid-cols-2 gap-2';

export default function AuditLogFilters(props: IAuditLogFiltersProps) {
  const v = useAuditLogFilters(props);

  return (
    <ListFilterPopover
      labels={{
        trigger: v.labels.trigger,
        heading: v.labels.heading,
        clear: v.labels.clear,
        activeCount: v.labels.activeCount,
      }}
      activeCount={props.activeFilters}
      onClear={props.onClear}
    >
      <div className={FIELD_CLASS}>
        <Label htmlFor="audit-filter-actor">{v.labels.actor}</Label>
        <Combobox
          id="audit-filter-actor"
          options={[...v.actorOptions]}
          value={v.actorValue}
          onValueChange={v.onActorValueChange}
          placeholder={v.labels.actorAll}
          searchPlaceholder={v.labels.search}
          emptyText={v.labels.noMatch}
          clearLabel={v.labels.actorAll}
          isLoading={v.isActorsLoading}
          loadingText={v.labels.loading}
        />
      </div>

      <div className={FIELD_CLASS}>
        <Label htmlFor="audit-filter-action">{v.labels.eventType}</Label>
        <Combobox
          id="audit-filter-action"
          options={[...v.actionOptions]}
          value={v.actionValue}
          onValueChange={v.onActionValueChange}
          placeholder={v.labels.eventTypeAll}
          searchPlaceholder={v.labels.search}
          emptyText={v.labels.noMatch}
          clearLabel={v.labels.eventTypeAll}
        />
      </div>

      <div className={RANGE_CLASS}>
        <div className={FIELD_CLASS}>
          <Label htmlFor="audit-filter-from">{v.labels.from}</Label>
          <DateField id="audit-filter-from" value={props.fromValue} onChange={v.onFromInput} />
        </div>
        <div className={FIELD_CLASS}>
          <Label htmlFor="audit-filter-to">{v.labels.to}</Label>
          <DateField id="audit-filter-to" value={props.toValue} onChange={v.onToInput} />
        </div>
      </div>
    </ListFilterPopover>
  );
}
