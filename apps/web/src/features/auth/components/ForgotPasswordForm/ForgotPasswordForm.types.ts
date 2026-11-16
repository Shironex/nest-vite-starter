import type { UseFormReturn } from 'react-hook-form';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import type { ForgotPasswordInput } from '@repo/shared/schemas';
import type { CaptchaStatus } from '@/features/auth/AuthForm.hooks';

export interface IForgotPasswordFormView {
  readonly form: UseFormReturn<ForgotPasswordInput>;
  readonly onSubmit: (data: ForgotPasswordInput) => void;
  readonly submitted: boolean;
  readonly serverError: string | null;
  readonly isPending: boolean;
  /** Receives focus when the confirmation block replaces the form. */
  readonly confirmationRef: React.RefObject<HTMLDivElement | null>;
  readonly turnstileRef: React.RefObject<TurnstileInstance | null>;
  /**
   * Passed straight to `TurnstileField`, which is the only thing that moves it,
   * and then to `AuthSubmit`, which is what makes the wait visible.
   */
  readonly onCaptchaStatusChange: (status: CaptchaStatus) => void;
  readonly captchaStatus: CaptchaStatus;
}
