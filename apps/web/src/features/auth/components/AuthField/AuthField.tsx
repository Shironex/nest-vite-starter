import type { FieldValues } from 'react-hook-form';
import { Input } from '@repo/ui/input';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@repo/ui/form';
import { useAuthField } from './AuthField.hooks';
import type { IAuthFieldProps } from './AuthField.types';

/**
 * One labeled text input in the auth treatment (the design's text field): 12px
 * label, 40px white field on a 10px radius, brand focus ring.
 *
 * It wraps the shadcn Form primitives rather than replacing them, so the
 * label/input `htmlFor`, `aria-describedby` and `aria-invalid` wiring keeps
 * coming from `FormControl` and the error copy from `FormMessage`.
 */
export default function AuthField<T extends FieldValues>({
  form,
  name,
  label,
  type,
  placeholder,
  autoComplete,
  inputMode,
  labelAction,
  required,
  children,
}: IAuthFieldProps<T>) {
  const { labelRowClass } = useAuthField({ labelAction });

  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="gap-1.5" required={required ?? false}>
          <div className={labelRowClass}>
            <FormLabel className="type-label-caption text-text-secondary">{label}</FormLabel>
            {labelAction}
          </div>
          <FormControl>
            <Input
              type={type}
              placeholder={placeholder}
              autoComplete={autoComplete}
              inputMode={inputMode}
              className="h-10 rounded-lg border-border bg-surface px-3.5 type-body-regular! text-text shadow-none placeholder:text-text-placeholder focus-visible:border-brand focus-visible:ring-brand/25 aria-invalid:border-danger aria-invalid:ring-danger/20"
              {...field}
            />
          </FormControl>
          {children}
          <FormMessage className="text-danger" />
        </FormItem>
      )}
    />
  );
}
