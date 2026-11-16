import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import { DateField } from './date-field';

const labels = {
  openCalendar: 'Open calendar',
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
  placeholder: 'mm/dd/yyyy',
  formatHint: 'Format mm/dd/yyyy.',
};

/** A controlled host, because the field's whole contract is with its parent. */
function Host({
  initial = '',
  locale,
  onChange,
}: {
  initial?: string;
  locale?: string;
  onChange?: (next: string) => void;
}) {
  const [value, setValue] = React.useState(initial);
  return (
    <>
      <label htmlFor="d">End date</label>
      <DateField
        id="d"
        value={value}
        labels={labels}
        locale={locale}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

function field() {
  return screen.getByLabelText('End date');
}

describe('DateField, typed entry', () => {
  it('is a labeled text input, so a label and a screen reader still reach it', () => {
    render(<Host />);
    expect(field()).toBeInstanceOf(HTMLInputElement);
    expect(field()).toHaveAttribute('type', 'text');
    expect(field()).toHaveAttribute('inputmode', 'numeric');
  });

  it('renders an existing value in the locale order, en-US by default', () => {
    render(<Host initial="2026-03-04" />);
    expect(field()).toHaveValue('03/04/2026');
  });

  it('renders and reads a day-first locale day first', () => {
    // The defect this component exists for: Chromium draws a native date input
    // in the BROWSER's order, so a de-DE product showed 03/04/2026 for 4 March.
    const onChange = vi.fn();
    render(<Host initial="2026-03-04" locale="de-DE" onChange={onChange} />);
    expect(field()).toHaveValue('04.03.2026');

    fireEvent.change(field(), { target: { value: '13052026' } });
    expect(field()).toHaveValue('13.05.2026');
    expect(onChange).toHaveBeenLastCalledWith('2026-05-13');
  });

  it('accepts a date typed straight through without the calendar opening', () => {
    const onChange = vi.fn();
    render(<Host onChange={onChange} />);
    fireEvent.change(field(), { target: { value: '05132026' } });

    expect(field()).toHaveValue('05/13/2026');
    expect(screen.getByTestId('value')).toHaveTextContent('2026-05-13');
    expect(screen.queryByRole('grid')).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith('2026-05-13');
  });

  it('inserts the separators as the groups fill', () => {
    render(<Host />);
    fireEvent.change(field(), { target: { value: '1' } });
    expect(field()).toHaveValue('1');
    fireEvent.change(field(), { target: { value: '05' } });
    expect(field()).toHaveValue('05');
    fireEvent.change(field(), { target: { value: '051' } });
    expect(field()).toHaveValue('05/1');
    fireEvent.change(field(), { target: { value: '05/132' } });
    expect(field()).toHaveValue('05/13/2');
  });

  it('lets a group be deleted again, which a trailing separator would prevent', () => {
    render(<Host />);
    fireEvent.change(field(), { target: { value: '0513' } });
    expect(field()).toHaveValue('05/13');
    fireEvent.change(field(), { target: { value: '05/1' } });
    expect(field()).toHaveValue('05/1');
    fireEvent.change(field(), { target: { value: '05/' } });
    expect(field()).toHaveValue('05');
    fireEvent.change(field(), { target: { value: '1' } });
    expect(field()).toHaveValue('1');
  });

  it('holds an empty value while the entry is still incomplete', () => {
    render(<Host />);
    fireEvent.change(field(), { target: { value: '0513' } });
    expect(screen.getByTestId('value')).toHaveTextContent('');
  });

  it('refuses a day that does not exist rather than rolling it forward', () => {
    render(<Host />);
    fireEvent.change(field(), { target: { value: '02/31/2026' } });
    // `new Date('2026-02-31')` would have become 3 March.
    expect(screen.getByTestId('value')).toHaveTextContent('');
  });

  it('normalizes an unpadded entry on blur', () => {
    render(<Host />);
    fireEvent.change(field(), { target: { value: '5.1.2026', selectionStart: 0 } });
    expect(screen.getByTestId('value')).toHaveTextContent('2026-05-01');
    fireEvent.blur(field());
    expect(field()).toHaveValue('05/01/2026');
  });

  it('leaves an unparseable entry on screen instead of erasing what was typed', () => {
    render(<Host />);
    fireEvent.change(field(), { target: { value: '99/99/2026', selectionStart: 0 } });
    fireEvent.blur(field());
    expect(field()).toHaveValue('99/99/2026');
    expect(screen.getByTestId('value')).toHaveTextContent('');
  });

  it('follows the value when the form resets it from outside', () => {
    function Resetting() {
      const [value, setValue] = React.useState('2026-05-13');
      return (
        <>
          <label htmlFor="r">Date</label>
          <DateField id="r" value={value} labels={labels} onChange={setValue} />
          <button type="button" onClick={() => setValue('')}>
            clear
          </button>
        </>
      );
    }
    render(<Resetting />);
    expect(screen.getByLabelText('Date')).toHaveValue('05/13/2026');
    fireEvent.click(screen.getByRole('button', { name: 'clear' }));
    expect(screen.getByLabelText('Date')).toHaveValue('');
  });
});

describe('DateField, the calendar', () => {
  it('opens from the trigger and announces the month in the locale', () => {
    render(<Host initial="2026-07-14" />);
    fireEvent.click(screen.getByRole('button', { name: labels.openCalendar }));

    const grid = screen.getByRole('grid');
    expect(grid).toBeInTheDocument();
    expect(screen.getByText('July 2026')).toBeInTheDocument();
  });

  it('opens from the keyboard with Alt+ArrowDown, the native convention', () => {
    render(<Host initial="2026-07-14" />);
    fireEvent.keyDown(field(), { key: 'ArrowDown', altKey: true });
    expect(screen.getByRole('grid')).toBeInTheDocument();
  });

  it('heads the columns Monday first, in the locale', () => {
    render(<Host initial="2026-07-14" />);
    fireEvent.click(screen.getByRole('button', { name: labels.openCalendar }));

    const headers = within(screen.getByRole('grid')).getAllByRole('columnheader');
    expect(headers).toHaveLength(7);
    expect(headers[0]).toHaveAttribute('aria-label', 'Monday');
    expect(headers[6]).toHaveAttribute('aria-label', 'Sunday');
  });

  it('names every day in full, so "15" is never announced bare', () => {
    render(<Host initial="2026-07-14" />);
    fireEvent.click(screen.getByRole('button', { name: labels.openCalendar }));
    expect(screen.getByRole('button', { name: 'July 15, 2026' })).toBeInTheDocument();
  });

  it('writes the picked day back in the wire shape', () => {
    render(<Host initial="2026-07-14" />);
    fireEvent.click(screen.getByRole('button', { name: labels.openCalendar }));
    fireEvent.click(screen.getByRole('button', { name: 'July 20, 2026' }));

    expect(screen.getByTestId('value')).toHaveTextContent('2026-07-20');
    expect(field()).toHaveValue('07/20/2026');
  });

  it('gives exactly one day a tab stop, so Tab leaves the grid', () => {
    render(<Host initial="2026-07-14" />);
    fireEvent.click(screen.getByRole('button', { name: labels.openCalendar }));

    const tabbable = within(screen.getByRole('grid'))
      .getAllByRole('button')
      .filter((button) => button.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAccessibleName('July 14, 2026');
  });

  it('moves the roving tab stop with the arrow keys', () => {
    render(<Host initial="2026-07-14" />);
    fireEvent.click(screen.getByRole('button', { name: labels.openCalendar }));

    const grid = screen.getByRole('grid');
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: 'July 21, 2026' })).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(grid, { key: 'ArrowLeft' });
    expect(screen.getByRole('button', { name: 'July 20, 2026' })).toHaveAttribute('tabindex', '0');
  });

  it('pages the month with PageUp and PageDown', () => {
    render(<Host initial="2026-07-14" />);
    fireEvent.click(screen.getByRole('button', { name: labels.openCalendar }));
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'PageDown' });
    expect(screen.getByText('August 2026')).toBeInTheDocument();
  });

  it('steps the month with the chevrons', () => {
    render(<Host initial="2026-07-14" />);
    fireEvent.click(screen.getByRole('button', { name: labels.openCalendar }));
    fireEvent.click(screen.getByRole('button', { name: labels.previousMonth }));
    expect(screen.getByText('June 2026')).toBeInTheDocument();
  });

  it('marks the selected day and does not mark any other', () => {
    render(<Host initial="2026-07-14" />);
    fireEvent.click(screen.getByRole('button', { name: labels.openCalendar }));

    const selected = within(screen.getByRole('grid'))
      .getAllByRole('gridcell')
      .filter((cell) => cell.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
  });

  it('refuses a day outside min and max instead of hiding it', () => {
    function Bounded() {
      const [value, setValue] = React.useState('2026-07-14');
      return (
        <>
          <label htmlFor="b">Date</label>
          <DateField
            id="b"
            value={value}
            labels={labels}
            min="2026-07-10"
            max="2026-07-20"
            onChange={setValue}
          />
          <output data-testid="bounded">{value}</output>
        </>
      );
    }
    render(<Bounded />);
    fireEvent.click(screen.getByRole('button', { name: labels.openCalendar }));

    const blocked = screen.getByRole('button', { name: 'July 25, 2026' });
    expect(blocked).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(blocked);
    expect(screen.getByTestId('bounded')).toHaveTextContent('2026-07-14');
  });

  it('points a forwarded ref at the input, without losing its own', () => {
    // Both halves matter: react-hook-form focuses the first field a resolver
    // rejected through this ref, and the component focuses the same input
    // itself when the calendar closes. Before the merge the internal ref won
    // and shouldFocusError had nothing to focus.
    const ref = React.createRef<HTMLInputElement>();
    render(<DateField ref={ref} value="2026-07-14" labels={labels} onChange={vi.fn()} />);

    const input = screen.getByRole('textbox');
    expect(ref.current).toBe(input);

    ref.current?.focus();
    expect(document.activeElement).toBe(input);
  });

  it('still returns focus to the input when the calendar picks a day', () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<DateField ref={ref} value="2026-07-14" labels={labels} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: labels.openCalendar }));
    fireEvent.click(screen.getByRole('button', { name: 'July 15, 2026' }));

    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('passes aria-required through to the input', () => {
    render(<DateField aria-required value="" labels={labels} onChange={vi.fn()} />);

    expect(screen.getByRole('textbox')).toHaveAttribute('aria-required', 'true');
  });
});
