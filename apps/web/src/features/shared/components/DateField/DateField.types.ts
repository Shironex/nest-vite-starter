import type * as React from 'react';

export interface IDateFieldProps {
  /**
   * `yyyy-MM-dd`, or `''` for empty. Unchanged from what `<input type="date">`
   * held, so every schema and every `toDateInputValue` round trip still fits.
   */
  readonly value: string;
  /** Receives `yyyy-MM-dd`, or `''` while the entry is incomplete or impossible. */
  readonly onChange: (value: string) => void;
  readonly onBlur?: (() => void) | undefined;
  /** Earliest selectable day as `yyyy-MM-dd`. */
  readonly min?: string | undefined;
  /** Latest selectable day as `yyyy-MM-dd`. */
  readonly max?: string | undefined;
  readonly name?: string | undefined;
  readonly id?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly className?: string | undefined;
  /*
   * `FormControl` injects these through a Radix Slot, so they arrive as props
   * rather than being set here. Declared explicitly so the injection is visible
   * in the type rather than surviving on a spread.
   */
  readonly 'aria-invalid'?: boolean | undefined;
  readonly 'aria-describedby'?: string | undefined;
  /*
   * Set at the call site rather than injected, because whether a field is
   * mandatory is a fact about the FORM and not about the control. Declared here
   * so a form's `aria-required` is intentional: hyphenated JSX
   * attributes are not excess-property-checked, so it reached the DOM through
   * the primitive's rest spread whether or not anybody meant it to.
   */
  readonly 'aria-required'?: boolean | undefined;
  /**
   * react-hook-form's `{...field}` spread carries one, and the primitive points
   * it at the real input so `shouldFocusError` can focus a rejected date.
   */
  readonly ref?: React.Ref<HTMLInputElement> | undefined;
}

/** The five strings the primitive cannot resolve for itself. */
export interface IDateFieldView {
  readonly labels: {
    readonly placeholder: string;
    readonly openCalendar: string;
    readonly previousMonth: string;
    readonly nextMonth: string;
    readonly formatHint: string;
  };
}
