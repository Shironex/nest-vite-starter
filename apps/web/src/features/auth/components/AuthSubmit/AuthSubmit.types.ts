import type { ComponentProps, ReactNode } from 'react';
import type { Button } from '@repo/ui/button';
import type { CaptchaStatus } from '@/features/auth/AuthForm.hooks';

export interface IAuthSubmitProps {
  /** The button's own copy in its normal, submittable state. */
  readonly children: ReactNode;
  /** True while the mutation is in flight or its navigation is completing. */
  readonly isPending: boolean;
  /**
   * Where the captcha is. Defaults to `ready`, so a form with no captcha at all
   * passes nothing and gets an ordinary submit button.
   */
  readonly captchaStatus?: CaptchaStatus;
  /** Defaults to the brand-filled primary treatment every auth screen uses. */
  readonly variant?: ComponentProps<typeof Button>['variant'];
  /** Replaces the default treatment outright, for the secondary resend action. */
  readonly className?: string;
}

export interface IAuthSubmitView {
  /** What the button says right now: its own copy, or why it cannot be used. */
  readonly label: ReactNode;
  readonly isDisabled: boolean;
  readonly isBusy: boolean;
  /** Explanatory line under the button, or null when there is nothing to say. */
  readonly hint: string | null;
  /** `polite` while waiting, `assertive` once the captcha has actually failed. */
  readonly hintTone: 'polite' | 'assertive';
}
