'use client';

import * as React from 'react';
import type { Label as LabelPrimitive } from 'radix-ui';
import { Slot } from 'radix-ui';
import {
  Controller,
  FormProvider,
  useFormContext,
  useFormState,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';

import { cn } from '@repo/ui/lib/utils';
import { Label } from '@repo/ui/label';

const Form = FormProvider;

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName;
};

const FormFieldContext = React.createContext<FormFieldContextValue>({} as FormFieldContextValue);

const FormField = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  ...props
}: ControllerProps<TFieldValues, TName>) => {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
};

const useFormField = () => {
  const fieldContext = React.useContext(FormFieldContext);
  const itemContext = React.useContext(FormItemContext);
  const { getFieldState } = useFormContext();
  const formState = useFormState({ name: fieldContext.name });
  const fieldState = getFieldState(fieldContext.name, formState);

  if (!fieldContext) {
    throw new Error('useFormField should be used within <FormField>');
  }

  const { id } = itemContext;

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  };
};

type FormItemContextValue = {
  id: string;
  required: boolean;
};

const FormItemContext = React.createContext<FormItemContextValue>({} as FormItemContextValue);

/**
 * `required` is declared HERE rather than on the label or the control, because
 * both of them owe the user something for it and neither can see the other:
 * the label owes a visible marker plus a spoken "required", and the control
 * owes `aria-required`. Splitting it into two props is one prop that can be
 * forgotten, and the thing forgotten is silent.
 *
 * The app had ZERO required markers before this: no `required`, no
 * `aria-required` anywhere in features, while the zod schemas make most fields
 * mandatory, so nobody learned which fields were compulsory until the form
 * refused to submit (WCAG 3.3.2).
 */
function FormItem({
  className,
  required = false,
  ...props
}: React.ComponentProps<'div'> & {
  required?: boolean;
}) {
  const id = React.useId();
  const value = React.useMemo(() => ({ id, required }), [id, required]);

  return (
    <FormItemContext.Provider value={value}>
      <div data-slot="form-item" className={cn('grid gap-2', className)} {...props} />
    </FormItemContext.Provider>
  );
}

/**
 * The required marker is CSS generated content, not a child element.
 *
 * TWO REASONS, both about the accessible name. A real `<span>*</span>` becomes
 * part of the label's text, so `<label>` no longer reads as the field's name
 * alone; and an sr-only "required" beside it would make every mandatory field
 * announce required TWICE, once from the label and once from `aria-required`
 * on the control, which is where a screen reader expects it. Generated content
 * carries the visual signal and leaves the name alone.
 */
const REQUIRED_MARKER_CLASS = "after:ml-0.5 after:text-destructive after:content-['*']";

function FormLabel({
  className,
  required,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root> & { required?: boolean }) {
  const { error, formItemId } = useFormField();
  const itemContext = React.useContext(FormItemContext);
  const isRequired = required ?? itemContext.required ?? false;

  return (
    <Label
      data-slot="form-label"
      data-error={!!error}
      data-required={isRequired || undefined}
      className={cn(
        'data-[error=true]:text-destructive',
        isRequired && REQUIRED_MARKER_CLASS,
        className,
      )}
      htmlFor={formItemId}
      {...props}
    />
  );
}

function FormControl({ ...props }: React.ComponentProps<typeof Slot.Root>) {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField();
  const { required } = React.useContext(FormItemContext);

  return (
    <Slot.Root
      data-slot="form-control"
      id={formItemId}
      aria-describedby={!error ? `${formDescriptionId}` : `${formDescriptionId} ${formMessageId}`}
      aria-invalid={!!error}
      aria-required={required || undefined}
      {...props}
    />
  );
}

function FormDescription({ className, ...props }: React.ComponentProps<'p'>) {
  const { formDescriptionId } = useFormField();

  return (
    <p
      data-slot="form-description"
      id={formDescriptionId}
      className={cn('type-body-small text-muted-foreground', className)}
      {...props}
    />
  );
}

function FormMessage({ className, ...props }: React.ComponentProps<'p'>) {
  const { error, formMessageId } = useFormField();
  const body = error ? String(error?.message ?? '') : props.children;

  if (!body) {
    return null;
  }

  return (
    <p
      data-slot="form-message"
      id={formMessageId}
      className={cn('type-body-small text-destructive', className)}
      {...props}
    >
      {body}
    </p>
  );
}

export {
  useFormField,
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormField,
};
