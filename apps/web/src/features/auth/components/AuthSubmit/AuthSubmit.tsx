import { Loader2 } from 'lucide-react';
import { Button } from '@repo/ui/button';
import { AUTH_SUBMIT_CLASS } from '@/features/auth/Auth.constants';
import { useAuthSubmit } from './AuthSubmit.hooks';
import type { IAuthSubmitProps } from './AuthSubmit.types';

/**
 * The submit button for every captcha-gated auth form.
 *
 * IT EXISTS BECAUSE OF A SILENT FAILURE. The auth schemas require a non-empty
 * Turnstile token, and Turnstile writes that token into the form some seconds
 * after the page paints. A click inside that window was refused by react-hook
 * -form's resolver against a hidden field, which produced NO request, NO error,
 * NO spinner and NO disabled state: the user pressed a live button and nothing
 * whatsoever happened, then pressed it again. On a real challenge, rather than
 * the always-pass test key, that window is seconds long and every user meets it.
 *
 * All four captcha-gated forms share this so the window is described the same
 * way in each, and so the next form to grow a captcha cannot reintroduce the
 * silence by forgetting to.
 */
export default function AuthSubmit({
  children,
  isPending,
  captchaStatus,
  variant,
  className = AUTH_SUBMIT_CLASS,
}: IAuthSubmitProps) {
  const { label, isDisabled, isBusy, hint, hintTone } = useAuthSubmit(
    children,
    isPending,
    captchaStatus,
  );

  return (
    <div className="grid gap-2">
      <Button
        type="submit"
        variant={variant}
        className={className}
        disabled={isDisabled}
        aria-busy={isBusy}
      >
        {isBusy && <Loader2 className="animate-spin" aria-hidden="true" />}
        {label}
      </Button>
      {hint ? (
        <p
          role="status"
          aria-live={hintTone}
          className="text-center type-label-caption text-text-tertiary"
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}
