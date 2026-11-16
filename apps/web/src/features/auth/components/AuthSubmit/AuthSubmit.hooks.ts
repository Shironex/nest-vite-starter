import type { ReactNode } from 'react';
import type { CaptchaStatus } from '@/features/auth/AuthForm.hooks';
import type { IAuthSubmitView } from './AuthSubmit.types';
import { authStrings } from '@/features/auth/Auth.strings';

/**
 * Turns the captcha's lifecycle into something the button can actually say.
 *
 * The rule the whole component exists to enforce: A BUTTON THAT CAN BE CLICKED
 * MUST DO SOMETHING. Every state that cannot produce a request disables the
 * control AND names the reason, so there is no window where a live-looking
 * button swallows a click in silence.
 */
export function useAuthSubmit(
  children: ReactNode,
  isPending: boolean,
  captchaStatus: CaptchaStatus = 'ready',
): IAuthSubmitView {
  const isVerifying = captchaStatus === 'pending';
  const hasFailed = captchaStatus === 'error' || captchaStatus === 'expired';

  return {
    // Only the waiting state renames the button. A failed captcha keeps the
    // action's own name and explains itself underneath, because the user's
    // intent has not changed and a button that renames itself on an error
    // reads as a different action appearing.
    label: isVerifying && !isPending ? authStrings.captcha.verifying : children,
    isDisabled: isPending || isVerifying || hasFailed,
    isBusy: isPending || isVerifying,
    hint: isVerifying
      ? authStrings.captcha.pendingHint
      : captchaStatus === 'error'
        ? authStrings.captcha.failed
        : captchaStatus === 'expired'
          ? authStrings.captcha.expired
          : null,
    hintTone: hasFailed ? 'assertive' : 'polite',
  };
}
