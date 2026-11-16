import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@repo/ui/button';
import { Input } from '@repo/ui/input';
import { Checkbox } from '@repo/ui/checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@repo/ui/form';
import { useTwoFactorChallenge } from './TwoFactorChallenge.hooks';
import type { ICodeSegmentsProps } from './TwoFactorChallenge.types';

/**
 * The two-factor challenge: authenticator code and backup code modes.
 *
 * The six boxes are a DECORATION painted behind one real `<input>`, not six
 * inputs. That is what keeps the hard parts working for free: pasting a code
 * from an authenticator fills the whole field, `one-time-code` autofill lands in
 * one place, backspace and the arrow keys behave the way the browser already
 * makes them behave, and a screen reader is handed a single labeled field
 * rather than six anonymous boxes. The strip is `aria-hidden` and
 * `pointer-events-none`, so neither assistive tech nor the mouse can reach it.
 *
 * Both modes are deliberately built to the SAME height. Toggling between them
 * must not move the controls underneath: the click-swallowing bug pinned by
 * e2e/two-factor.spec.ts is caused by exactly that kind of reflow, and equal
 * heights make the guarantee structural instead of incidental.
 */

const CODE_LENGTH = 6;

/** Height of the code field in both modes; the segment boxes set it. */
const FIELD_HEIGHT_CLASS = 'h-16';

/** Two lines at type-body-small, so the longer backup hint reserves no more. */
const HINT_HEIGHT_CLASS = 'min-h-10';

/**
 * Two lines at type-body-regular. Both mode descriptions are 2 lines in a 400px
 * column (both drawn at 400x40), and reserving the box
 * means the toggle below cannot move even if one of them is later reworded.
 */
const DESCRIPTION_HEIGHT_CLASS = 'min-h-11';

const SUBMIT_CLASS =
  'type-body-medium! h-10.5 w-full rounded-lg bg-brand text-brand-fg shadow-none hover:bg-brand-hover';

const SEGMENT_BASE = `flex ${FIELD_HEIGHT_CLASS} flex-1 items-center justify-center rounded-lg border bg-surface type-display-large text-text`;

export default function TwoFactorChallenge() {
  const { t } = useTranslation();
  const { form, onSubmit, serverError, isPending, isRecoveryMode, onToggleRecoveryMode } =
    useTwoFactorChallenge();

  const codeLabel = isRecoveryMode
    ? t('twoFactor.challenge.codeLabelRecovery')
    : t('twoFactor.challenge.codeLabelTotp');
  const codeHint = isRecoveryMode
    ? t('twoFactor.challenge.hintRecovery')
    : t('twoFactor.challenge.hintTotp');
  const codePlaceholder = isRecoveryMode ? 'XXXX-XXXX-XXXX-XXXX' : '';
  const inputMode = isRecoveryMode ? 'text' : 'numeric';
  const description = isRecoveryMode
    ? t('twoFactor.challenge.descriptionRecovery')
    : t('twoFactor.challenge.descriptionTotp');
  const toggleQuestion = isRecoveryMode
    ? t('twoFactor.challenge.toggleQuestionRecovery')
    : t('twoFactor.challenge.toggleQuestionTotp');
  const toggleLabel = isRecoveryMode
    ? t('twoFactor.challenge.toggleToTotp')
    : t('twoFactor.challenge.toggleToRecovery');
  const badgeIcon = isRecoveryMode ? (
    <KeyRound aria-hidden="true" />
  ) : (
    <ShieldCheck aria-hidden="true" />
  );

  // The segmented treatment is for the 6-digit authenticator code only; a backup
  // code is up to 19 characters and takes an ordinary field. It
  // keeps the segment height so the toggle never shifts what sits below it.
  const codeInputClass = isRecoveryMode
    ? `type-body-regular! ${FIELD_HEIGHT_CLASS} rounded-lg border-border bg-surface px-3.5 text-center text-text shadow-none placeholder:text-text-placeholder focus-visible:border-brand focus-visible:ring-brand/25`
    : `type-display-large! relative ${FIELD_HEIGHT_CLASS} rounded-lg border-transparent bg-transparent text-center text-transparent caret-transparent shadow-none focus-visible:ring-0`;

  return (
    <Form {...form}>
      <div className="mb-7">
        <span className="mb-5 flex size-12 items-center justify-center rounded-xl bg-brand-tint text-brand-ink [&_svg]:size-5">
          {badgeIcon}
        </span>
        <h1 className="type-heading-h1 text-text">{t('twoFactor.challenge.heading')}</h1>
        <p className={`mt-2 ${DESCRIPTION_HEIGHT_CLASS} type-body-regular text-text-muted`}>
          {description}
        </p>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
        {serverError && (
          <div
            role="alert"
            className="rounded-lg bg-danger-bg px-3.5 py-3 type-body-small text-danger-strong"
          >
            {serverError}
          </div>
        )}

        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <FormItem className="gap-1.5" required>
              <FormLabel className="type-label-caption text-text-secondary">{codeLabel}</FormLabel>
              <div className="relative">
                {!isRecoveryMode && <CodeSegments value={field.value} />}
                <FormControl>
                  <Input
                    autoComplete="one-time-code"
                    autoFocus
                    inputMode={inputMode}
                    placeholder={codePlaceholder}
                    className={codeInputClass}
                    {...field}
                  />
                </FormControl>
              </div>
              <p className={`${HINT_HEIGHT_CLASS} type-body-small text-text-muted`}>{codeHint}</p>
              {/*
                Reserve the message row. `mode: 'onBlur'` renders "Code is
                required" the moment this (autofocused, empty) input loses
                focus, which is exactly what pressing the trust checkbox or
                the mode toggle does. Letting the message appear would push
                both controls down between mousedown and mouseup, so the
                browser resolves `click` against the form instead of the
                control and the first press is silently swallowed.
              */}
              <div className="min-h-5">
                <FormMessage className="text-danger" />
              </div>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="trustDevice"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center gap-2.5">
              <FormControl>
                <Checkbox checked={field.value ?? false} onCheckedChange={field.onChange} />
              </FormControl>
              <FormLabel className="mt-0! cursor-pointer type-body-small text-text-secondary">
                {t('twoFactor.challenge.trustDevice')}
              </FormLabel>
            </FormItem>
          )}
        />

        <Button type="submit" className={SUBMIT_CLASS} disabled={isPending}>
          {isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {t('twoFactor.challenge.submit')}
        </Button>

        <p className="text-center type-body-small text-text-muted">
          {toggleQuestion}{' '}
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 type-body-small font-medium text-brand-ink hover:text-brand-ink-hover"
            onClick={onToggleRecoveryMode}
          >
            {toggleLabel}
          </Button>
        </p>
      </form>
    </Form>
  );
}

/**
 * The six boxes from the design. Reads the live input value and paints one
 * character per slot, highlighting the slot the caret is about to fill.
 */
function CodeSegments({ value }: ICodeSegmentsProps) {
  const characters = Array.from({ length: CODE_LENGTH }, (_, index) => value[index] ?? '');
  const activeIndex = Math.min(value.length, CODE_LENGTH - 1);

  const boxes = characters.map((character, index) => (
    <span
      key={`segment-${String(index)}`}
      className={
        index === activeIndex
          ? `${SEGMENT_BASE} border-brand ring-2 ring-brand/25`
          : `${SEGMENT_BASE} border-border`
      }
    >
      {character}
    </span>
  ));

  const leadingBoxes = boxes.slice(0, 3);
  const trailingBoxes = boxes.slice(3);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex items-center gap-2.5"
    >
      {leadingBoxes}
      <span className="h-0.5 w-2.5 shrink-0 rounded-full bg-border-strong" />
      {trailingBoxes}
    </div>
  );
}
