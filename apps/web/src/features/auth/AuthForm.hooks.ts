import { useCallback, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  useForm,
  type FieldValues,
  type Path,
  type PathValue,
  type Resolver,
  type UseFormProps,
} from 'react-hook-form';
import type { UseFormReturn, DefaultValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import type { AppErrorCode } from '@repo/shared/errors';
import { getAppErrorCode, translateAppError } from '@/lib/trpc-errors';
import { commonStrings } from '@/lib/strings';

/**
 * Where the captcha is in its lifecycle, as far as the FORM can tell.
 *
 * `ready` is the initial value on purpose, and it is the whole reason a form
 * whose captcha field is absent (a test that stubs it out, an environment where
 * the widget never mounts) still submits: the gate closes only once a widget
 * has announced itself. Fail-open on the UI matches `useTurnstileField`, where
 * the server's fail-closed verification is the real control.
 */
export type CaptchaStatus = 'ready' | 'pending' | 'error' | 'expired';

export interface IUseAuthFormOptions<TFieldValues extends FieldValues> {
  readonly schema: z.ZodType<TFieldValues, FieldValues>;
  readonly defaultValues: DefaultValues<TFieldValues>;
  /** react-hook-form validation mode; the auth forms default to onBlur. */
  readonly mode?: UseFormProps<TFieldValues>['mode'];
  /**
   * User-facing copy per structured AppErrorCode (see getAppErrorCode). Codes
   * without an entry fall back to the shared `errorStrings` sentence for that code,
   * then to the generic unexpected-error copy.
   */
  readonly errorMessages?: Partial<Record<AppErrorCode, string>>;
}

export interface IUseAuthFormResult<TFieldValues extends FieldValues> {
  readonly form: UseFormReturn<TFieldValues>;
  readonly serverError: string | null;
  readonly setServerError: (message: string | null) => void;
  /** Mutation onError handler: form-specific copy, else the shared `errorStrings`, else generic. */
  readonly handleServerError: (error: { message: string }) => void;
  /**
   * Pass to TurnstileField (forms without a captcha just leave it unused).
   * Wired so handleServerError can re-arm the widget after a failed submit.
   */
  readonly turnstileRef: RefObject<TurnstileInstance | null>;
  /** Pass to TurnstileField, which is the only thing that ever moves this. */
  readonly onCaptchaStatusChange: (status: CaptchaStatus) => void;
  /**
   * What the submit button should say and whether it should be clickable.
   *
   * The form's zod schema requires a non-empty token, so a submit fired before
   * the widget has written one is REFUSED BY VALIDATION with no field to attach
   * the error to: no request, no message, no spinner, no disabled state. The
   * user clicked a live button and learned nothing, and clicked again. Reading
   * the captcha's own state here is what makes that window visible instead of
   * silent.
   */
  readonly captchaStatus: CaptchaStatus;
  /** True while the captcha cannot yet produce a token the server will accept. */
  readonly isCaptchaBlocking: boolean;
}

/**
 * Shared wiring for the auth forms (login, register, forgot/reset password,
 * resend verification): zod-resolved react-hook-form instance plus the
 * serverError state and its AppErrorCode-aware onError mapping. Flow-specific
 * branches (field errors, redirect flags) stay in each form's own hook.
 */
export function useAuthForm<TFieldValues extends FieldValues>(
  options: IUseAuthFormOptions<TFieldValues>,
): IUseAuthFormResult<TFieldValues> {
  const { schema, defaultValues, mode = 'onBlur', errorMessages } = options;
  const [serverError, setServerError] = useState<string | null>(null);
  const [captchaStatus, setCaptchaStatus] = useState<CaptchaStatus>('ready');

  const form = useForm<TFieldValues>({
    // Schemas with defaulted fields (e.g. loginSchema's rememberMe) make the
    // zod input type differ from the output; pin the resolver to the
    // field-values type the same way the forms did individually.
    resolver: zodResolver(schema) as Resolver<TFieldValues>,
    mode,
    defaultValues,
  });

  const turnstileRef = useRef<TurnstileInstance | null>(null);

  const handleServerError = useCallback(
    (error: { message: string }) => {
      // Turnstile tokens are single-use and the server consumes one on every
      // attempt (validateTurnstile runs before the credential checks), so any
      // failed submit must re-arm the widget and drop the spent token or every
      // retry fails with TURNSTILE_FAILED until the widget's ~5-min expiry.
      if (turnstileRef.current) {
        turnstileRef.current.reset();
        form.setValue(
          'turnstileToken' as Path<TFieldValues>,
          '' as PathValue<TFieldValues, Path<TFieldValues>>,
        );
        // A reset widget has no token again, so the submit has to close behind
        // it or the very next click reproduces the silent-refusal window.
        setCaptchaStatus('pending');
      }
      const code = getAppErrorCode(error);
      const mapped = code !== undefined ? errorMessages?.[code] : undefined;
      // `loginErrorMessages` maps only two codes, so INVALID_CREDENTIALS,
      // RATE_LIMITED and INTERNAL_ERROR used to reach the sign-in screen as
      // the api's own sentence. `errorStrings` has reviewed copy for
      // every AppErrorCode, so it is the second choice, not the message.
      setServerError(mapped ?? translateAppError(error) ?? commonStrings.errors.unexpected);
    },
    [errorMessages, form],
  );

  return {
    form,
    serverError,
    setServerError,
    handleServerError,
    turnstileRef,
    onCaptchaStatusChange: setCaptchaStatus,
    captchaStatus,
    // `error` and `expired` are blocking too: the widget holds no usable token
    // in either, and the copy the form shows tells the user which it is.
    isCaptchaBlocking: captchaStatus !== 'ready',
  };
}
