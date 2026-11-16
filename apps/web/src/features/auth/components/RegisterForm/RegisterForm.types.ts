import type { RefObject } from 'react';
import type { RegisterInput } from '@repo/shared/schemas';
import type { UseFormReturn } from 'react-hook-form';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import type { CaptchaStatus } from '@/features/auth/AuthForm.hooks';

export interface IRegisterFormView {
  readonly form: UseFormReturn<RegisterInput>;
  readonly onSubmit: (data: RegisterInput) => void;
  readonly serverError: string | null;
  readonly isPending: boolean;
  readonly password: string;
  readonly turnstileRef: RefObject<TurnstileInstance | null>;
  /**
   * Passed straight to `TurnstileField`, which is the only thing that moves it,
   * and then to `AuthSubmit`, which is what makes the wait visible.
   */
  readonly onCaptchaStatusChange: (status: CaptchaStatus) => void;
  readonly captchaStatus: CaptchaStatus;
}
