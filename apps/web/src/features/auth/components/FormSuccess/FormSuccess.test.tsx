import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import FormSuccess from './FormSuccess';

describe('FormSuccess', () => {
  it('renders the message inside a role="status" region with the success classes', () => {
    render(<FormSuccess>Email sent!</FormSuccess>);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Email sent!');
    expect(status).toHaveClass('rounded-lg', 'bg-success-bg', 'text-success', 'type-body-small');
  });

  it('prepends a caller-supplied className', () => {
    render(<FormSuccess className="w-full">msg</FormSuccess>);
    const className = screen.getByRole('status').className;
    // Prepended, not appended, so tailwind-merge resolves a caller's utility
    // against the defaults rather than the other way round. Asserted as a
    // prefix because the prettier tailwind plugin owns the order of the rest.
    expect(className.startsWith('w-full ')).toBe(true);
    expect(className).toContain('bg-success-bg');
  });
});
