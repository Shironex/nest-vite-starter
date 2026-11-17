'use client';

import * as React from 'react';
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';

import { Button } from '@repo/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@repo/ui/popover';
import {
  DAYS_PER_WEEK,
  addUtcDays,
  dateEntryPattern,
  addUtcMonths,
  fromIsoDate,
  isSameUtcDay,
  isSameUtcMonth,
  isWeekend,
  makeUtcDate,
  monthGridWeeks,
  startOfUtcMonth,
  toIsoDate,
  todayUtc,
  weekdayNames,
} from '@repo/ui/lib/calendar';
import type { DatePart, IDateEntryPattern } from '@repo/ui/lib/calendar';
import { cn } from '@repo/ui/lib/utils';

/**
 * A date field that reads and is typed in the local written form, with a
 * calendar the keyboard can drive.
 *
 * WHY THIS EXISTS INSTEAD OF `<input type="date">`. Chromium takes a native date
 * input's display format from the BROWSER'S UI LANGUAGE and ignores both the
 * element's `lang` attribute and the browsing context's locale. A day-first
 * product on a Chrome installed in US English renders `03/04/2026`, which a
 * reader cannot disambiguate: 3 April and 4 March are both real deadlines and
 * they look identical. No attribute, stylesheet or app setting fixes it,
 * which is why the control itself is replaced rather than configured. Firefox
 * honors `lang`; Chrome does not.
 *
 * THE WRITTEN FORM FOLLOWS `locale`. The order of the three groups and the
 * separator come from `dateEntryPattern(locale)`: `07/24/2026` for `en-US`,
 * `24.07.2026` for `de-DE`, `2026-07-24` for `sv-SE`. The locale is chosen by
 * the product, never by the browser, so every user of one deployment reads and
 * types dates the same way.
 *
 * WHAT IT MUST NOT LOSE. The native control was keyboard-accessible,
 * screen-reader-labelled and usable on a phone for free, so a replacement that
 * gives any of that up is a downgrade rather than a fix:
 *
 *   - It is a real `<input>`, so a `<label htmlFor>` still names it, `FormControl`
 *     still injects `id` / `aria-describedby` / `aria-invalid` through the Slot,
 *     and a screen reader announces the value as text.
 *   - TYPING IS THE PRIMARY PATH. `05/13/2026` reaches the form without the
 *     calendar ever opening; someone entering thirty dates from a stack of
 *     documents never touches the popover. The calendar is the secondary path,
 *     opened with the button or with Alt+ArrowDown from the field.
 *   - `inputMode="numeric"` gives a phone the numeric keypad. What is genuinely
 *     lost is the OS date wheel, and that is the trade: a wheel in the wrong
 *     format is worse than a keypad in the right one.
 *
 * THE VALUE CONTRACT IS UNCHANGED. `value` and `onChange` speak `yyyy-MM-dd`,
 * exactly what the native control held, so every zod schema, every
 * `toDateInputValue` / `fromDateInputValue` round trip and every react-hook-form
 * registration keeps working untouched. An incomplete or impossible entry emits
 * `''` rather than a half-parsed string: the old native fallback path could
 * hand `31/03/2020` straight to a resolver, and one place in this app was
 * already defending against that.
 *
 * MOTION. The popover animates through `MOTION_ANCHORED_CLASS`, whose every
 * variant ends in `motion-reduce:animate-none!`, so `prefers-reduced-motion`
 * removes the open/close movement at the class level, before any choreography
 * rather than inside it.
 */

/** Copy this component cannot resolve for itself. */
export interface IDateFieldLabels {
  /** Accessible name of the button that opens the calendar. */
  readonly openCalendar: string;
  readonly previousMonth: string;
  readonly nextMonth: string;
  /**
   * Shown while the field is empty, e.g. `mm/dd/yyyy`. Build it from
   * `dateEntryPattern(locale).placeholder` so it matches what the field accepts.
   */
  readonly placeholder: string;
  /**
   * Announced hint tying the two input paths together, e.g. "Format
   * mm/dd/yyyy. Type the date, or press Alt and the down arrow to open the
   * calendar." Rendered visually hidden and referenced from the input.
   */
  readonly formatHint: string;
}

export interface IDateFieldProps {
  /** `yyyy-MM-dd`, or `''` for empty. */
  value: string;
  /** Receives `yyyy-MM-dd`, or `''` while the entry is incomplete or impossible. */
  onChange: (value: string) => void;
  onBlur?: (() => void) | undefined;
  labels: IDateFieldLabels;
  /**
   * BCP 47 tag driving the month and weekday names and the order a date is
   * typed and shown in. Defaults to `en-US`.
   */
  locale?: string | undefined;
  /** Earliest selectable day as `yyyy-MM-dd`. Days before it cannot be picked. */
  min?: string | undefined;
  /** Latest selectable day as `yyyy-MM-dd`. */
  max?: string | undefined;
  name?: string | undefined;
  id?: string | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
  'aria-invalid'?: boolean | undefined;
  'aria-describedby'?: string | undefined;
  'aria-required'?: boolean | undefined;
}

const DEFAULT_LOCALE = 'en-US';

/** A full date is eight digits (two, two and four) and two separators. */
const MAX_DIGITS = 8;
const MAX_TEXT_LENGTH = 10;

const FIELD_CLASS =
  'h-9 w-full min-w-0 rounded-md border border-input bg-transparent py-1 pr-10 pl-3 type-body-regular shadow-xs transition-[color,box-shadow] outline-none tabular-nums selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 max-md:text-base dark:bg-input/30';
const FIELD_FOCUS_CLASS =
  'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';
const FIELD_INVALID_CLASS =
  'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40';
const TRIGGER_CLASS =
  'absolute top-1/2 right-1 size-7 -translate-y-1/2 text-text-muted hover:text-text';
const DAY_CLASS =
  'flex size-8 items-center justify-center rounded-md type-body-regular tabular-nums transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

/** Digits in each group: the year is always written in full. */
const PART_DIGITS: Record<DatePart, number> = { day: 2, month: 2, year: 4 };

/**
 * Digits typed so far, rendered as far as they go in the locale's pattern. For
 * `mm/dd/yyyy`: `1` -> `1`, `071` -> `07/1`, `07132026` -> `07/13/2026`.
 *
 * The separator appears only once a digit follows it, never as a trailing hint.
 * A trailing separator would be a trap: backspacing over it leaves the group's
 * digits, which this function would immediately re-decorate, and the group
 * could never be deleted. Someone typing eight digits straight through still
 * never types a separator.
 */
function maskDigits(raw: string, pattern: IDateEntryPattern): string {
  let digits = raw.replace(/\D/g, '').slice(0, MAX_DIGITS);
  const groups: string[] = [];
  for (const part of pattern.order) {
    if (digits === '') break;
    groups.push(digits.slice(0, PART_DIGITS[part]));
    digits = digits.slice(PART_DIGITS[part]);
  }
  return groups.join(pattern.separator);
}

/**
 * A typed date as `yyyy-MM-dd`, or `''`.
 *
 * Deliberately lenient about SEPARATORS (`.`, `-`, `/`) and about unpadded day
 * and month groups (`7/4/2026`), because those are all things a person
 * genuinely types, and strict about the ORDER and the RESULT: the groups are
 * read in the locale's order, and the parts must name a day that exists.
 * Two-digit years are rejected rather than guessed: this field records
 * deadlines, and silently reading `26` as 2026 is the kind of guess that is
 * wrong once and unnoticed forever.
 */
function parseTypedDate(text: string, pattern: IDateEntryPattern): string {
  const match = /^\s*(\d{1,4})[./-](\d{1,4})[./-](\d{1,4})\s*$/.exec(text);
  if (match === null) return '';
  const values: Partial<Record<DatePart, string>> = {};
  pattern.order.forEach((part, index) => {
    values[part] = match[index + 1] ?? '';
  });
  const { day = '', month = '', year = '' } = values;
  if (year.length !== 4 || day.length > 2 || month.length > 2) return '';
  const date = makeUtcDate(Number(year), Number(month), Number(day));
  return date === null ? '' : toIsoDate(date);
}

/** `yyyy-MM-dd` back to the text the field shows. */
function isoToText(value: string, pattern: IDateEntryPattern): string {
  const date = fromIsoDate(value);
  if (date === null) return '';
  const digits: Record<DatePart, string> = {
    day: String(date.getUTCDate()).padStart(2, '0'),
    month: String(date.getUTCMonth() + 1).padStart(2, '0'),
    year: String(date.getUTCFullYear()).padStart(4, '0'),
  };
  return maskDigits(pattern.order.map((part) => digits[part]).join(''), pattern);
}

function isOutOfRange(day: Date, min: Date | null, max: Date | null): boolean {
  if (min !== null && day.getTime() < min.getTime()) return true;
  return max !== null && day.getTime() > max.getTime();
}

function DateFieldImpl({
  value,
  onChange,
  onBlur,
  labels,
  locale = DEFAULT_LOCALE,
  min,
  max,
  name,
  id,
  disabled = false,
  className,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  'aria-required': ariaRequired,
  forwardedRef,
  ...rest
}: IDateFieldProps & { forwardedRef: React.Ref<HTMLInputElement> | undefined }) {
  const pattern = dateEntryPattern(locale);
  const [text, setText] = React.useState(() => isoToText(value, pattern));
  /*
   * Adjusting state when a prop changes, the documented React pattern: a reset
   * from outside (the form loading a row, `setValue('')` when an era stops
   * asking for a filing) must reach the text, but a keystroke must not be
   * overwritten by the round trip through the parent. Comparing against the
   * LAST SEEN prop rather than against the current text is what separates the
   * two: only an outside change differs from what we last emitted.
   */
  const [lastValue, setLastValue] = React.useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setText(isoToText(value, pattern));
  }

  const [open, setOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const hintId = React.useId();

  /*
   * BOTH REFS ARE NEEDED, so the forwarded one is POINTED AT the internal node
   * rather than replacing it.
   *
   * This component focuses the input from four places (a day picked, Escape out
   * of the calendar, a dismissed popover that would otherwise drop focus on
   * `<body>`), and react-hook-form needs the same node to focus the first field
   * a resolver rejected. Before this, `ref={inputRef}` simply overwrote the ref
   * arriving in the `{...field}` spread, so `shouldFocusError` had nothing to
   * focus and a form failing validation below the fold appeared to do nothing.
   *
   * `useImperativeHandle` rather than a merged callback ref because the
   * forwarded ref may be an object, and writing to a prop's `.current` from a
   * ref callback is exactly what the React compiler refuses.
   */
  React.useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement, []);

  const minDate = min === undefined ? null : fromIsoDate(min);
  const maxDate = max === undefined ? null : fromIsoDate(max);

  function commit(next: string) {
    setLastValue(next);
    onChange(next);
  }

  function onInput(event: React.ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value;
    /*
     * Re-masking only while the caret sits at the end keeps the common case
     * (typing straight through) effortless without breaking the other one:
     * correcting a digit in the middle of the year would otherwise have the
     * caret snap to the end after every keystroke.
     */
    const isAtEnd = event.target.selectionStart === raw.length;
    const nextText = isAtEnd
      ? maskDigits(raw, pattern)
      : raw.replace(/[^\d./-]/g, '').slice(0, MAX_TEXT_LENGTH);
    setText(nextText);
    commit(parseTypedDate(nextText, pattern));
  }

  function onFieldBlur() {
    // Normalize what survived: `7/4/2026` becomes `07/04/2026` so the field
    // reads back the way every other date on the screen is written. An
    // unparseable entry is left exactly as typed; erasing it would hide the
    // typo the validation message is about to name.
    const parsed = parseTypedDate(text, pattern);
    if (parsed !== '') setText(isoToText(parsed, pattern));
    onBlur?.();
  }

  function onSelectDay(day: Date) {
    commit(toIsoDate(day));
    setText(isoToText(toIsoDate(day), pattern));
    setOpen(false);
    inputRef.current?.focus();
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    /*
     * Radix's own focus return is switched off (see `onCloseAutoFocus`), so
     * closing has to say where focus goes. Dismissing with Escape unmounts the
     * day that had focus and would otherwise drop it on `<body>`, which is the
     * one case worth catching: an outside click has already put focus on
     * whatever was clicked, and taking it back would fight the user.
     */
    if (next) return;
    queueMicrotask(() => {
      if (document.activeElement === document.body) inputRef.current?.focus();
    });
  }

  function onFieldKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    // The convention every native combobox-with-popup uses, and the one the
    // native date input itself answered to.
    if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
    }
  }

  const selected = fromIsoDate(value);

  return (
    <div data-slot="date-field" className={cn('relative w-full', className)}>
      <input
        {...rest}
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={text}
        placeholder={labels.placeholder}
        aria-invalid={ariaInvalid}
        aria-required={ariaRequired}
        aria-describedby={
          ariaDescribedBy === undefined ? hintId : `${ariaDescribedBy} ${hintId}`.trim()
        }
        onChange={onInput}
        onBlur={onFieldBlur}
        onKeyDown={onFieldKeyDown}
        className={cn(FIELD_CLASS, FIELD_FOCUS_CLASS, FIELD_INVALID_CLASS)}
      />
      {/*
        The format and the keyboard shortcut, announced rather than drawn. A
        visible hint under twelve fields would be noise; a screen-reader user
        has no placeholder to fall back on.
      */}
      <span id={hintId} className="sr-only">
        {labels.formatHint}
      </span>

      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label={labels.openCalendar}
            className={TRIGGER_CLASS}
            data-slot="date-field-trigger"
          >
            <CalendarIcon className="size-4" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-auto p-3"
          align="start"
          data-slot="date-field-calendar"
          onOpenAutoFocus={(event) => {
            // Radix would focus the first tabbable node, which is the previous
            // month chevron. The grid takes focus itself on mount, because the
            // grid is what the user came for.
            event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            // Radix returns focus to the trigger, which is the little calendar
            // button. Focus belongs back in the field the date was going into,
            // and every path out of here puts it there explicitly.
            event.preventDefault();
          }}
        >
          <DateCalendar
            selected={selected}
            locale={locale}
            minDate={minDate}
            maxDate={maxDate}
            labels={labels}
            onSelect={onSelectDay}
            onDismiss={() => {
              setOpen(false);
              inputRef.current?.focus();
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

interface IDateCalendarProps {
  readonly selected: Date | null;
  readonly locale: string;
  readonly minDate: Date | null;
  readonly maxDate: Date | null;
  readonly labels: IDateFieldLabels;
  readonly onSelect: (day: Date) => void;
  readonly onDismiss: () => void;
}

/**
 * The month grid, driven entirely from the keyboard.
 *
 * SEMANTICS. A `role="grid"` table with real column headers, which is the
 * pattern assistive technology already knows for a calendar: the weekday of a
 * cell is announced from its column, and each day button carries the full
 * written date as its accessible name so "15" is never announced without the
 * month it belongs to. Today additionally carries `aria-current="date"`, so the
 * marker is not the filled circle alone.
 *
 * ROVING TABINDEX. Exactly one day is tabbable at a time and the arrow keys
 * move it, so Tab leaves the grid rather than walking 42 cells.
 */
function DateCalendar({
  selected,
  locale,
  minDate,
  maxDate,
  labels,
  onSelect,
  onDismiss,
}: IDateCalendarProps) {
  const [today] = React.useState(() => todayUtc());
  const [cursor, setCursor] = React.useState<Date>(() => selected ?? today);
  const gridRef = React.useRef<HTMLTableSectionElement>(null);

  const monthLabelId = React.useId();
  const monthFormatter = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const dayFormatter = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  /*
   * The focused day is moved by the keyboard and then applied to the DOM here,
   * rather than each button deciding to focus itself while rendering.
   *
   * It runs on mount too, and that is the point: the arrow keys are handled on
   * the popover, so until focus is actually inside the grid every arrow press
   * goes to the text field behind it and the calendar looks frozen. This grid
   * only exists while the popover is open, so taking focus on mount is exactly
   * the dialog behavior a date picker is expected to have.
   */
  const cursorKey = cursor.getTime();
  React.useEffect(() => {
    const target = gridRef.current?.querySelector<HTMLButtonElement>('[data-focused="true"]');
    if (!target) return;
    target.focus();
    if (document.activeElement === target) return;
    /*
     * The focus on the opening frame is a no-op, verified in a browser: Radix
     * positions the popper one frame after it mounts and the content is not
     * focusable until it has, so `focus()` silently does nothing and every
     * arrow key then goes to the text field behind the calendar. Retried on the
     * next frame, and only when the first attempt did not take, so moving
     * between days stays instant.
     */
    const frame = requestAnimationFrame(() => target.focus());
    return () => cancelAnimationFrame(frame);
  }, [cursorKey]);

  function onGridKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    const moves: Record<string, () => Date> = {
      ArrowLeft: () => addUtcDays(cursor, -1),
      ArrowRight: () => addUtcDays(cursor, 1),
      ArrowUp: () => addUtcDays(cursor, -DAYS_PER_WEEK),
      ArrowDown: () => addUtcDays(cursor, DAYS_PER_WEEK),
      Home: () => addUtcDays(cursor, -((cursor.getUTCDay() + 6) % DAYS_PER_WEEK)),
      End: () => addUtcDays(cursor, DAYS_PER_WEEK - 1 - ((cursor.getUTCDay() + 6) % DAYS_PER_WEEK)),
      PageUp: () => addUtcMonths(cursor, event.shiftKey ? -12 : -1),
      PageDown: () => addUtcMonths(cursor, event.shiftKey ? 12 : 1),
    };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      setCursor(move());
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onDismiss();
    }
  }

  const weekdays = weekdayNames(locale);
  const headerCells = weekdays.map((day) => (
    <th
      key={day.long}
      scope="col"
      className="size-8 type-body-small font-normal text-text-muted"
      aria-label={day.long}
    >
      <span aria-hidden="true">{day.short}</span>
    </th>
  ));

  const weeks = monthGridWeeks(cursor);
  const rows = weeks.map((week) => {
    const cells = week.map((day) => {
      const iso = toIsoDate(day);
      const isOutside = !isSameUtcMonth(day, cursor);
      const isSelected = selected !== null && isSameUtcDay(day, selected);
      const isToday = isSameUtcDay(day, today);
      const isFocused = isSameUtcDay(day, cursor);
      const isDisabled = isOutOfRange(day, minDate, maxDate);

      return (
        <td key={iso} role="gridcell" aria-selected={isSelected} className="p-0">
          <button
            type="button"
            data-day={iso}
            data-focused={isFocused ? 'true' : undefined}
            tabIndex={isFocused ? 0 : -1}
            aria-label={dayFormatter.format(day)}
            aria-disabled={isDisabled || undefined}
            aria-current={isToday ? 'date' : undefined}
            onClick={() => {
              if (isDisabled) return;
              onSelect(day);
            }}
            className={cn(
              DAY_CLASS,
              isOutside && 'text-text-placeholder',
              !isOutside && 'text-text',
              isWeekend(day) && !isSelected && 'bg-subtle',
              isDisabled && 'cursor-not-allowed opacity-40',
              !isDisabled && !isSelected && 'hover:bg-hover',
              isToday && !isSelected && 'font-semibold ring-1 ring-brand ring-inset',
              isSelected && 'bg-brand text-brand-fg',
            )}
          >
            {day.getUTCDate()}
          </button>
        </td>
      );
    });

    return (
      <tr key={toIsoDate(week[0] as Date)} role="row">
        {cells}
      </tr>
    );
  });

  return (
    <div className="space-y-2" onKeyDown={onGridKeyDown}>
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={labels.previousMonth}
          onClick={() => setCursor(addUtcMonths(startOfUtcMonth(cursor), -1))}
        >
          <ChevronLeftIcon className="size-4" aria-hidden="true" />
        </Button>
        <span
          id={monthLabelId}
          aria-live="polite"
          className="type-body-strong text-text capitalize"
        >
          {monthFormatter.format(cursor)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={labels.nextMonth}
          onClick={() => setCursor(addUtcMonths(startOfUtcMonth(cursor), 1))}
        >
          <ChevronRightIcon className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <table
        role="grid"
        aria-labelledby={monthLabelId}
        className="border-separate border-spacing-1"
      >
        <thead>
          <tr role="row">{headerCells}</tr>
        </thead>
        <tbody ref={gridRef}>{rows}</tbody>
      </table>
    </div>
  );
}

/**
 * A `forwardRef` wrapper, so react-hook-form's `{...field}` spread reaches the
 * input. The body stays a plain function because the ref has to be merged with
 * the internal one rather than replace it; see `useMergedInputRef`.
 */
const DateField = React.forwardRef<HTMLInputElement, IDateFieldProps>((props, ref) => (
  <DateFieldImpl {...props} forwardedRef={ref} />
));
DateField.displayName = 'DateField';

export { DateField };
