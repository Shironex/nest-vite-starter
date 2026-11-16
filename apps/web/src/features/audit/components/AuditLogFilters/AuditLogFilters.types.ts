import type { IComboboxOption } from '@repo/ui/combobox';

export interface IAuditLogFiltersProps {
  readonly actorId: string;
  readonly action: string;
  readonly fromValue: string;
  readonly toValue: string;
  /**
   * How many narrowings are set, for the trigger badge. Counted by the page,
   * which owns the values; the date range counts once rather than twice.
   */
  readonly activeFilters: number;
  readonly onActorChange: (value: string) => void;
  readonly onActionChange: (value: string) => void;
  readonly onFromChange: (value: string) => void;
  readonly onToChange: (value: string) => void;
  readonly onClear: () => void;
}

export interface IAuditLogFiltersView {
  /** `null` is "no filter". The Combobox uses null rather than a sentinel. */
  readonly actorValue: string | null;
  readonly actionValue: string | null;
  readonly actorOptions: readonly IComboboxOption[];
  /** Every event type, each carrying the group it files under. */
  readonly actionOptions: readonly IComboboxOption[];
  readonly isActorsLoading: boolean;
  readonly onActorValueChange: (value: string | null) => void;
  readonly onActionValueChange: (value: string | null) => void;
  /** Both receive `yyyy-MM-dd`, or `''` while an entry is incomplete. */
  readonly onFromInput: (value: string) => void;
  readonly onToInput: (value: string) => void;
  readonly labels: {
    readonly trigger: string;
    readonly heading: string;
    readonly activeCount: string;
    readonly actor: string;
    readonly actorAll: string;
    readonly eventType: string;
    readonly eventTypeAll: string;
    readonly search: string;
    readonly noMatch: string;
    readonly loading: string;
    readonly from: string;
    readonly to: string;
    readonly clear: string;
  };
}
