import { useEffect } from 'react';
import { TURNSTILE_SITE_KEY } from '@/lib/env';
import type { CaptchaStatus } from '@/features/auth/AuthForm.hooks';
import type { ITurnstileFieldView } from './TurnstileField.types';

/** Cloudflare always-passes test key. */
const TURNSTILE_TEST_KEY = '1x00000000000000000000AA';

export function useTurnstileField(
  onStatusChange?: (status: CaptchaStatus) => void,
): ITurnstileFieldView {
  /*
   * Announce "pending" the moment a widget actually exists.
   *
   * The form defaults to `ready`, so a form that never renders this field (or a
   * test that stubs it out) stays submittable. Closing the gate here rather
   * than in the form means the form never has to know whether it HAS a captcha,
   * only whether the one it has is usable.
   */
  useEffect(() => {
    onStatusChange?.('pending');
  }, [onStatusChange]);

  if (!TURNSTILE_SITE_KEY && !import.meta.env.DEV) {
    // Fail-open on the UI only: rendering with the always-pass test key keeps
    // auth usable while the server's fail-closed turnstile verification stays
    // the real gate. The loud log makes a misconfigured build visible.
    console.error(
      '[turnstile] TURNSTILE_SITE_KEY is not set in the runtime config; ' +
        'rendering the always-pass test widget. Server-side verification remains enforced.',
    );
  }

  const siteKey = TURNSTILE_SITE_KEY || TURNSTILE_TEST_KEY;
  return { siteKey };
}
