import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import FormError from './FormError';

describe('FormError', () => {
  it('renders the message inside a role="alert" region with the destructive classes', () => {
    render(<FormError>Something went wrong</FormError>);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong');
    expect(alert).toHaveClass(
      'rounded-lg',
      'bg-danger-bg',
      'text-danger-strong',
      'type-body-small',
    );
  });

  it('prepends a caller-supplied className', () => {
    render(<FormError className="w-full">msg</FormError>);
    const className = screen.getByRole('alert').className;
    // Prepended, not appended, so tailwind-merge resolves a caller's utility
    // against the defaults rather than the other way round. Asserted as a
    // prefix because the prettier tailwind plugin owns the order of the rest.
    expect(className.startsWith('w-full ')).toBe(true);
    expect(className).toContain('bg-danger-bg');
  });
});
