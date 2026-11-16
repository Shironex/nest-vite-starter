import { Search } from 'lucide-react';
import { Input } from '@repo/ui/input';
import { useListSearchField } from './ListSearchField.hooks';
import type { IListSearchFieldProps } from './ListSearchField.types';

/**
 * The toolbar's search box: the leading half of the one list toolbar.
 *
 * `type="search"` rather than `type="text"` so the browser offers its own clear
 * affordance and so the field is announced as a search. The magnifier is inside
 * the field, as the design draws it, which is why the input carries left padding
 * rather than sitting in a flex row beside an icon.
 */

const WRAP_CLASS = 'relative min-w-0 flex-1';
const ICON_CLASS =
  'pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-tertiary';
const INPUT_CLASS = 'pl-9';

export default function ListSearchField(props: IListSearchFieldProps) {
  const v = useListSearchField(props);

  return (
    <div className={WRAP_CLASS} data-slot="list-search-field">
      <Search className={ICON_CLASS} aria-hidden="true" />
      <Input
        id={props.id}
        type="search"
        className={INPUT_CLASS}
        aria-label={props.label}
        placeholder={props.placeholder}
        value={props.value}
        onChange={v.onInput}
      />
    </div>
  );
}
