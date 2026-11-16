import type { RefObject } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import type { LoginInput } from '@repo/shared/schemas';
import type { CaptchaStatus } from '@/features/auth/AuthForm.hooks';

export interface ILoginFormView {
  readonly form: UseFormReturn<LoginInput>;
  readonly onSubmit: (data: LoginInput) => void;
  readonly serverError: string | null;
  readonly isPending: boolean;
  readonly turnstileRef: RefObject<TurnstileInstance | null>;
  /**
   * Passed straight to `TurnstileField`, which is the only thing that moves it,
   * and then to `AuthSubmit`, which is what makes the wait visible.
   */
  readonly onCaptchaStatusChange: (status: CaptchaStatus) => void;
  readonly captchaStatus: CaptchaStatus;
}
