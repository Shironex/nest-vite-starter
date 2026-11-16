import type { HTMLInputTypeAttribute, ReactNode } from 'react';
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';

export interface IAuthFieldProps<T extends FieldValues> {
  readonly form: UseFormReturn<T>;
  readonly name: Path<T>;
  readonly label: string;
  readonly type?: HTMLInputTypeAttribute;
  readonly placeholder?: string;
  readonly autoComplete?: string;
  readonly inputMode?: 'text' | 'numeric' | 'email';
  /** Right-aligned affordance on the label row, e.g. the "forgot password" link. */
  readonly labelAction?: ReactNode;
  /** Marks the field mandatory: an asterisk, a spoken "required", aria-required. */
  readonly required?: boolean;
  /** Rendered under the input, above the validation message (password meters). */
  readonly children?: ReactNode;
}

export interface IAuthFieldView {
  readonly labelRowClass: string;
}
