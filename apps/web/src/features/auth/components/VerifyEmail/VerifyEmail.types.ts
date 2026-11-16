import type { ReactNode, RefObject } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import type { ResendVerificationInput } from '@repo/shared/schemas';
import type { CaptchaStatus } from '@/features/auth/AuthForm.hooks';

export type VerifyStatus = 'loading' | 'success' | 'error';

/** Shared centered badge + heading + body used by every state of this screen. */
export interface IVerifyEmailStateProps {
  /** Background and foreground token classes for the 48px badge. */
  readonly badgeClass: string;
  readonly icon: ReactNode;
  readonly title: string;
  readonly description: ReactNode;
  readonly children?: ReactNode;
}

/** Props for the "check your email" (no token) branch. */
export interface ICheckYourEmailProps {
  /** True when registration succeeded but the verification email failed to send. */
  readonly emailSendFailed: boolean;
}

/** View model for the auto-verify (token present) branch. */
export interface IVerifyWithTokenView {
  readonly status: VerifyStatus;
  readonly errorMessage: string | null;
  /** Re-runs verification for the same token after a failure. */
  readonly retry: () => void;
}

/** View model for the "check your email" + resend (no token) branch. */
export interface ICheckYourEmailView {
  readonly form: UseFormReturn<ResendVerificationInput>;
  readonly onResend: (data: ResendVerificationInput) => void;
  readonly resendSuccess: boolean;
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
