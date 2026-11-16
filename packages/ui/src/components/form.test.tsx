import { useForm } from 'react-hook-form';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Input } from '@repo/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel } from '@repo/ui/form';

/**
 * Required fields, which the app marked nowhere at all before this.
 *
 * There were zero `required` and zero `aria-required` attributes across every
 * form in the product while the zod schemas made most fields mandatory, so a
 * screen-reader user heard nothing and a sighted user learned which fields were
 * compulsory only by submitting and reading the error (WCAG 3.3.2).
 */
function Field({ required }: { required?: boolean }) {
  const form = useForm<{ email: string }>({ defaultValues: { email: '' } });

  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="email"
        render={({ field }) => (
          <FormItem required={required ?? false}>
            <FormLabel>Email address</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
          </FormItem>
        )}
      />
    </Form>
  );
}

describe('FormItem required', () => {
  it('puts aria-required on the control, where a screen reader expects it', () => {
    render(<Field required />);
    expect(screen.getByLabelText('Email address')).toHaveAttribute('aria-required', 'true');
  });

  it('flags the label so the visual marker renders', () => {
    render(<Field required />);
    expect(screen.getByText('Email address')).toHaveAttribute('data-required', 'true');
  });

  /**
   * The marker is CSS generated content on purpose. A real `<span>*</span>`
   * child would land inside the label's text, so the field would no longer be
   * named by its label alone; every existing `getByLabelText('Email address')`
   * in the app is the same assertion from the consumer side.
   */
  it('leaves the accessible name exactly the label text', () => {
    render(<Field required />);
    expect(screen.getByRole('textbox', { name: 'Email address' })).toBeInTheDocument();
  });

  it('marks nothing when the field is optional', () => {
    render(<Field />);
    const input = screen.getByLabelText('Email address');
    expect(input).not.toHaveAttribute('aria-required');
    expect(screen.getByText('Email address')).not.toHaveAttribute('data-required');
  });
});
