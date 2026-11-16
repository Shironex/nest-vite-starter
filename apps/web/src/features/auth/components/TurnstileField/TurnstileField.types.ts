import type { Ref } from 'react';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';
import type { CaptchaStatus } from '@/features/auth/AuthForm.hooks';

export interface ITurnstileFieldProps<T extends FieldValues> {
  readonly form: UseFormReturn<T>;
  readonly name?: Path<T>;
  /** Lets the owning form reset the single-use widget after a failed submit. */
  readonly turnstileRef?: Ref<TurnstileInstance | null>;
  /**
   * Tells the owning form whether a submit can currently succeed.
   *
   * Without it the form has no way to know a token is still in flight, so a
   * click in that window is refused by validation with nothing on screen to
   * explain it. `useAuthForm` supplies this as `onCaptchaStatusChange`.
   */
  readonly onStatusChange?: (status: CaptchaStatus) => void;
}

export interface ITurnstileFieldView {
  readonly siteKey: string;
}
