import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DateField } from './index';

/**
 * The wrapper's whole job is attaching the catalog copy and the app locale
 * (`APP_LOCALE`, `en-US`), so that is what is asserted here. The typing, parsing and keyboard behavior are
 * the primitive's and are covered in `@repo/ui`.
 */
describe('DateField', () => {
  it('renders the value in the app locale order, mm/dd/yyyy for en-US', () => {
    render(
      <>
        <label htmlFor="d">Date</label>
        <DateField id="d" value="2026-03-04" onChange={vi.fn()} />
      </>,
    );
    expect(screen.getByLabelText('Date')).toHaveValue('03/04/2026');
    expect(screen.getByLabelText('Date')).toHaveAttribute('placeholder', 'mm/dd/yyyy');
  });

  it('names the calendar trigger from the catalog', () => {
    render(<DateField value="" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Open calendar' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Format mm/dd/yyyy. Type the date, or press Alt and the down arrow to open the calendar.',
      ),
    ).toBeInTheDocument();
  });

  it('draws the app locale month and day names in the popover', () => {
    render(<DateField value="2026-07-14" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open calendar' }));

    expect(screen.getByText('July 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'July 20, 2026' })).toBeInTheDocument();
  });

  it('emits the wire shape the form already speaks', () => {
    const onChange = vi.fn();
    render(<DateField value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '05132026' } });
    expect(onChange).toHaveBeenLastCalledWith('2026-05-13');
  });

  it('carries the ref and aria-required a form field arrives with', () => {
    // Both come off the call site rather than out of this wrapper: the ref via
    // react-hook-form's {...field} spread, aria-required from the form that
    // knows the field is mandatory. Declared on IDateFieldProps so neither
    // survives on an untyped spread.
    const ref = createRef<HTMLInputElement>();
    render(<DateField ref={ref} aria-required value="" onChange={vi.fn()} />);

    const input = screen.getByRole('textbox');
    expect(ref.current).toBe(input);
    expect(input).toHaveAttribute('aria-required', 'true');
  });
});
