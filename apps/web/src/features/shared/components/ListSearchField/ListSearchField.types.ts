import type { ChangeEvent } from 'react';

export interface IListSearchFieldProps {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  /**
   * Accessible name for the field. The toolbar draws no visible `<Label>`: the
   * design's row is an icon and a placeholder, and a label above it
   * would break the single-line toolbar every list now shares.
   */
  readonly label: string;
  readonly placeholder: string;
  readonly id?: string | undefined;
}

export interface IListSearchFieldView {
  readonly onInput: (event: ChangeEvent<HTMLInputElement>) => void;
}
