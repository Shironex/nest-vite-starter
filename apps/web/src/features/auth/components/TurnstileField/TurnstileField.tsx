import { Turnstile } from '@marsidev/react-turnstile';
import { FormField, FormItem, FormControl, FormMessage } from '@repo/ui/form';
import type { FieldValues, Path } from 'react-hook-form';
import { useTurnstileField } from './TurnstileField.hooks';
import type { ITurnstileFieldProps } from './TurnstileField.types';

export default function TurnstileField<T extends FieldValues>({
  form,
  name = 'turnstileToken' as Path<T>,
  turnstileRef,
  onStatusChange,
}: ITurnstileFieldProps<T>) {
  const { siteKey } = useTurnstileField(onStatusChange);

  return (
    <FormField
      control={form.control}
      name={name}
      render={() => (
        <FormItem>
          <FormControl>
            <Turnstile
              ref={turnstileRef}
              siteKey={siteKey}
              onSuccess={(token: string) => {
                form.setValue(name, token as T[typeof name], {
                  shouldValidate: true,
                });
                onStatusChange?.('ready');
              }}
              onError={() => {
                form.setValue(name, '' as T[typeof name]);
                onStatusChange?.('error');
              }}
              onExpire={() => {
                form.setValue(name, '' as T[typeof name]);
                onStatusChange?.('expired');
              }}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
