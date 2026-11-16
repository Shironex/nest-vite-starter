import type { ReactNode } from 'react';
import type { IAuthFieldView } from './AuthField.types';

export function useAuthField({ labelAction }: { labelAction?: ReactNode }): IAuthFieldView {
  return {
    // With a trailing action the label row becomes a space-between row (the
    // password label paired with its "forgot password" link); without one the
    // label keeps FormItem's normal flow.
    labelRowClass: labelAction === undefined ? '' : 'flex items-center justify-between gap-4',
  };
}
