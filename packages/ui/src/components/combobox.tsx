'use client';

import * as React from 'react';
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react';

import { Button } from '@repo/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@repo/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@repo/ui/popover';
import { Spinner } from '@repo/ui/spinner';
import { cn } from '@repo/ui/lib/utils';

/**
 * A picker with type-to-search.
 *
 * WHEN TO REACH FOR THIS RATHER THAN `Select`. The two are not stylistic
 * alternatives, they answer different questions:
 *
 * - `Select` is for a BOUNDED ENUM the user can read in one glance: a theme
 *   (3 options), a record status, a role, a sort order. Every
 *   option is on screen, so there is nothing to search for.
 * - `Combobox` is for a list the user has to FIND something in: every user
 *   of the app, every project, the 74 audit event types. If you cannot
 *   promise the list stays short, it belongs here.
 *
 * The API makes the choice hard to get wrong: `searchPlaceholder` is required,
 * so adding a combobox forces you to name what the user would type. If naming
 * it feels silly, the answer is `Select`.
 *
 * CLIENT OR SERVER FILTERING. By default `cmdk` filters the options it was
 * given. Pass `search` and `onSearchChange` and filtering switches off: the
 * consumer owns the query, which is the shape an unbounded list needs, because
 * the server has already limited what came back and filtering that slice again
 * would hide rows the user can see the count of.
 *
 * GROUPS AND DESCRIPTIONS are part of the option, not a separate composition
 * step, because both of the surfaces that need them (audit event types in
 * sections; statutory subpart letters with a two-line explanation) get their
 * options from a schema rather than from JSX.
 */

interface IComboboxOption {
  value: string;
  label: string;
  /** Second line under the label, for options that need explaining. */
  description?: string | undefined;
  /** Heading to file this option under. Options sharing one render together. */
  group?: string | undefined;
  disabled?: boolean | undefined;
}

/**
 * Everything a `<button>` takes, minus the handful this component owns.
 *
 * THIS EXISTS FOR `FormControl`. The Slot it renders injects `id`,
 * `aria-describedby` and `aria-invalid` into whatever it wraps, and a component
 * that destructures only its own named props drops all three on the floor: the
 * label binds, the error message does not, and the field is announced valid
 * while react-hook-form is refusing to submit it. `aria-required` arrives the
 * same way. So the rest lands on the trigger.
 */
type ComboboxTriggerProps = Omit<
  React.ComponentPropsWithoutRef<'button'>,
  'value' | 'defaultValue' | 'onChange' | 'onSelect' | 'type' | 'children' | 'placeholder'
>;

interface IComboboxProps extends ComboboxTriggerProps {
  options: IComboboxOption[];
  /** `null` means nothing is chosen. */
  value: string | null;
  onValueChange: (value: string | null) => void;
  /** Trigger text while nothing is chosen. */
  placeholder: string;
  /** Search field placeholder. Required on purpose; see the note above. */
  searchPlaceholder: string;
  /** Shown when the search matches nothing. */
  emptyText: string;
  /**
   * When given, an entry at the top of the list clears the value. This is how a
   * filter offers "all" without a magic sentinel option value.
   */
  clearLabel?: string | undefined;
  /** Controlled search term. Supplying it switches off client-side filtering. */
  search?: string | undefined;
  onSearchChange?: ((search: string) => void) | undefined;
  isLoading?: boolean | undefined;
  /** Announced while `isLoading`. */
  loadingText?: string | undefined;
  disabled?: boolean | undefined;
  /**
   * Marks the trigger invalid, the same way a native control would be.
   *
   * Present because the surfaces that moved from `Select` to `Combobox` carried
   * an error state and silently lost it in the swap: a field could be rejected
   * by validation and look identical to one that was not. Rendered as
   * `aria-invalid` rather than a color alone, so the state reaches assistive
   * technology and not only sighted users.
   */
  hasError?: boolean | undefined;
  /**
   * Associates the trigger with the element describing the error.
   *
   * Kept alongside the inherited `aria-describedby` rather than replaced by it,
   * because the two have different sources: this one is passed by a caller that
   * knows the id, the other is injected by `FormControl`. Both are honored and
   * both ids end up on the trigger.
   */
  describedBy?: string | undefined;
  className?: string | undefined;
  id?: string | undefined;
}

const TRIGGER_CLASS = 'w-full justify-between font-normal';
const CONTENT_CLASS = 'w-(--radix-popover-trigger-width) p-0';
const STATUS_CLASS =
  'flex items-center justify-center gap-2 py-6 type-body-regular text-text-muted';

/**
 * The ref goes to the TRIGGER, which is the control react-hook-form focuses
 * when its resolver rejects the field. Without it `field.ref` has nothing to
 * hold, so a failed submit moves focus nowhere and a screen-reader user is left
 * on the submit button with no announcement and no way to find the field.
 */
const Combobox = React.forwardRef<HTMLButtonElement, IComboboxProps>(function Combobox(
  {
    options,
    value,
    onValueChange,
    placeholder,
    searchPlaceholder,
    emptyText,
    clearLabel,
    search,
    onSearchChange,
    isLoading = false,
    loadingText,
    disabled = false,
    hasError = false,
    describedBy,
    className,
    id,
    'aria-invalid': ariaInvalid,
    'aria-describedby': ariaDescribedBy,
    ...rest
  },
  ref,
) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((option) => option.value === value);
  const isServerFiltered = onSearchChange !== undefined;
  /*
   * Only handed over when the consumer owns the query. Making the input
   * controlled with an undefined value would flip it between controlled and
   * uncontrolled on the first keystroke.
   */
  const searchProps = isServerFiltered
    ? { value: search ?? '', onValueChange: onSearchChange }
    : {};

  const choose = (next: string | null) => {
    onValueChange(next);
    setOpen(false);
  };

  /*
   * Both sources of each attribute, merged rather than one overwriting the
   * other: `hasError` is what a caller outside a form passes, `aria-invalid` is
   * what `FormControl` injects, and a field is invalid if either says so. The
   * described-by ids are joined for the same reason, so a form's description
   * and its error message both survive a caller-supplied `describedBy`.
   */
  const isInvalid = hasError || ariaInvalid === true || ariaInvalid === 'true';
  const describedByIds = [ariaDescribedBy, describedBy].filter(Boolean).join(' ');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          {...rest}
          ref={ref}
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={isInvalid || undefined}
          aria-describedby={describedByIds === '' ? undefined : describedByIds}
          disabled={disabled}
          className={cn(TRIGGER_CLASS, className)}
          data-slot="combobox-trigger"
          data-placeholder={selected === undefined ? '' : undefined}
        >
          <span className={cn('truncate', selected === undefined && 'text-text-placeholder')}>
            {selected === undefined ? placeholder : selected.label}
          </span>
          <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={CONTENT_CLASS} align="start" data-slot="combobox-content">
        <Command shouldFilter={!isServerFiltered}>
          <CommandInput placeholder={searchPlaceholder} {...searchProps} />
          <CommandList>
            <ComboboxBody
              options={options}
              value={value}
              onChoose={choose}
              emptyText={emptyText}
              clearLabel={clearLabel}
              isLoading={isLoading}
              loadingText={loadingText}
            />
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
});

interface IComboboxBodyProps {
  options: IComboboxOption[];
  value: string | null;
  onChoose: (value: string | null) => void;
  emptyText: string;
  clearLabel?: string | undefined;
  isLoading: boolean;
  loadingText?: string | undefined;
}

function ComboboxBody({
  options,
  value,
  onChoose,
  emptyText,
  clearLabel,
  isLoading,
  loadingText,
}: IComboboxBodyProps) {
  if (isLoading) {
    return (
      <div role="status" className={STATUS_CLASS}>
        <Spinner size="sm" />
        {loadingText === undefined ? null : <span>{loadingText}</span>}
      </div>
    );
  }

  const groups = groupOptions(options);

  return (
    <>
      <CommandEmpty>{emptyText}</CommandEmpty>
      {clearLabel === undefined ? null : (
        <CommandGroup>
          <ComboboxItem
            option={{ value: '', label: clearLabel }}
            isSelected={value === null}
            onSelect={() => onChoose(null)}
          />
        </CommandGroup>
      )}
      {groups.map((group) => (
        <CommandGroup key={group.heading ?? '__ungrouped'} heading={group.heading}>
          {group.options.map((option) => (
            <ComboboxItem
              key={option.value}
              option={option}
              isSelected={option.value === value}
              onSelect={() => onChoose(option.value)}
            />
          ))}
        </CommandGroup>
      ))}
    </>
  );
}

interface IComboboxItemProps {
  option: IComboboxOption;
  isSelected: boolean;
  onSelect: () => void;
}

function ComboboxItem({ option, isSelected, onSelect }: IComboboxItemProps) {
  return (
    <CommandItem
      /*
       * cmdk matches on `value`, and our values are ids and enum keys, so a
       * search for "Nolan" would match nothing. The label goes in as the
       * search key and the choice is made by the closure instead.
       */
      value={`${option.label} ${option.description ?? ''}`}
      onSelect={onSelect}
      disabled={option.disabled ?? false}
      data-slot="combobox-item"
      className={cn('items-start gap-2', option.description !== undefined && 'py-2')}
    >
      <CheckIcon
        className={cn('mt-0.5 size-4 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')}
      />
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{option.label}</span>
        {option.description === undefined ? null : (
          <span className="type-label-caption text-text-muted">{option.description}</span>
        )}
      </span>
    </CommandItem>
  );
}

interface IComboboxGroup {
  heading?: string | undefined;
  options: IComboboxOption[];
}

/**
 * Preserves the order the options arrived in, both within a group and between
 * groups. A schema-derived list is already in a deliberate order and sorting it
 * here would silently reorder the audit event sections.
 */
function groupOptions(options: IComboboxOption[]): IComboboxGroup[] {
  const groups: IComboboxGroup[] = [];
  const byHeading = new Map<string | undefined, IComboboxGroup>();

  for (const option of options) {
    let group = byHeading.get(option.group);
    if (group === undefined) {
      group = option.group === undefined ? { options: [] } : { heading: option.group, options: [] };
      byHeading.set(option.group, group);
      groups.push(group);
    }
    group.options.push(option);
  }

  return groups;
}

export { Combobox, groupOptions, type IComboboxOption, type IComboboxProps };
