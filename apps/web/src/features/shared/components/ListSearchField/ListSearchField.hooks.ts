import type { ChangeEvent } from 'react';
import type { IListSearchFieldProps, IListSearchFieldView } from './ListSearchField.types';

/** Unwraps the change event so the shell hands the caller a plain string. */
export function useListSearchField({ onValueChange }: IListSearchFieldProps): IListSearchFieldView {
  return {
    onInput: (event: ChangeEvent<HTMLInputElement>) => onValueChange(event.target.value),
  };
}
