import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { CaptchaStatus } from '@/features/auth/AuthForm.hooks';
import type { IAuthSubmitView } from './AuthSubmit.types';

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
  const { t } = useTranslation();

  const isVerifying = captchaStatus === 'pending';
  const hasFailed = captchaStatus === 'error' || captchaStatus === 'expired';

  return {
    // Only the waiting state renames the button. A failed captcha keeps the
    // action's own name and explains itself underneath, because the user's
    // intent has not changed and a button that renames itself on an error
    // reads as a different action appearing.
    label: isVerifying && !isPending ? t('auth.captcha.verifying') : children,
    isDisabled: isPending || isVerifying || hasFailed,
    isBusy: isPending || isVerifying,
    hint: isVerifying
      ? t('auth.captcha.pendingHint')
      : captchaStatus === 'error'
        ? t('auth.captcha.failed')
        : captchaStatus === 'expired'
          ? t('auth.captcha.expired')
          : null,
    hintTone: hasFailed ? 'assertive' : 'polite',
  };
}
