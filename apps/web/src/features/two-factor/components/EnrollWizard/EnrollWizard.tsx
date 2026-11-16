import { Loader2 } from 'lucide-react';
import { Button } from '@repo/ui/button';
import { Input } from '@repo/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@repo/ui/form';
import { RecoveryCodesPanel } from '../RecoveryCodesPanel';
import { useEnrollWizard } from './EnrollWizard.hooks';
import type { IEnrollWizardProps } from './EnrollWizard.types';
import { twoFactorStrings } from '@/features/two-factor/TwoFactor.strings';

/** The instruction line that opens each step. */
const STEP_HINT_CLASS = 'type-body-small text-text-muted';

/**
 * `bg-white` IS DELIBERATE AND MUST NOT BECOME `bg-surface`.
 *
 * The QR is a black-module PNG with a transparent background, so the backing IS
 * the quiet zone a camera needs. `bg-surface` resolves to `#171B26` under the
 * dark theme, which would put black modules on a near-black field and make the
 * code unscannable exactly when the user is trying to enroll. It stays light in
 * both themes for the same reason a printed QR is always printed on white.
 */
const QR_CLASS = 'mx-auto size-48 rounded-lg bg-white p-2';

export default function EnrollWizard(props: IEnrollWizardProps) {
  const {
    step,
    passwordForm,
    onBeginEnrollment,
    isBeginning,
    confirmForm,
    onActivate,
    isActivating,
    qrDataUri,
    secretBase32,
    recoveryCodes,
    onFinish,
  } = useEnrollWizard(props);

  return (
    <div className="flex flex-col gap-4" data-slot="two-factor-enroll-wizard">
      {step === 'password' && (
        <Form {...passwordForm}>
          <form onSubmit={passwordForm.handleSubmit(onBeginEnrollment)} className="space-y-4">
            <p className={STEP_HINT_CLASS}>{twoFactorStrings.enroll.passwordHint}</p>
            <FormField
              control={passwordForm.control}
              name="password"
              render={({ field }) => (
                <FormItem required>
                  <FormLabel>{twoFactorStrings.enroll.passwordLabel}</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="current-password"
                      placeholder={twoFactorStrings.enroll.passwordPlaceholder}
                      {...field}
                    />
                  </FormControl>
                  {/*
                    Reserved row. `mode: 'onBlur'` renders "Password is
                    required" when this field loses focus, which is what
                    pressing Continue does; an unreserved row would push the
                    button down between mousedown and mouseup and the press
                    would land on the form. Pinned in e2e/form-reflow.spec.ts.
                  */}
                  <div className="min-h-5">
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />
            <Button type="submit" disabled={isBeginning}>
              {isBeginning && <Loader2 className="animate-spin" />}
              {twoFactorStrings.enroll.continue}
            </Button>
          </form>
        </Form>
      )}

      {step === 'confirm' && (
        <Form {...confirmForm}>
          <form onSubmit={confirmForm.handleSubmit(onActivate)} className="space-y-4">
            <p className={STEP_HINT_CLASS}>{twoFactorStrings.enroll.scanHint}</p>
            {qrDataUri && (
              <img src={qrDataUri} alt={twoFactorStrings.enroll.qrAlt} className={QR_CLASS} />
            )}
            {secretBase32 && (
              <div className="space-y-1 text-center">
                <p className="type-body-small text-text-muted">
                  {twoFactorStrings.enroll.manualHint}
                </p>
                <code className="type-mono-small tracking-widest text-text">{secretBase32}</code>
              </div>
            )}
            <FormField
              control={confirmForm.control}
              name="code"
              render={({ field }) => (
                <FormItem required>
                  <FormLabel>{twoFactorStrings.enroll.codeLabel}</FormLabel>
                  <FormControl>
                    <Input
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      placeholder="123456"
                      autoFocus
                      {...field}
                    />
                  </FormControl>
                  {/* Reserved row, same reason as the password step above. */}
                  <div className="min-h-5">
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />
            <Button type="submit" disabled={isActivating}>
              {isActivating && <Loader2 className="animate-spin" />}
              {twoFactorStrings.enroll.verifyCta}
            </Button>
          </form>
        </Form>
      )}

      {step === 'codes' && (
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="type-body-strong text-text">{twoFactorStrings.enroll.codesTitle}</p>
            <p className={STEP_HINT_CLASS}>{twoFactorStrings.enroll.codesHint}</p>
          </div>
          <RecoveryCodesPanel codes={recoveryCodes ?? []} />
          <Button type="button" onClick={onFinish}>
            {twoFactorStrings.enroll.done}
          </Button>
        </div>
      )}
    </div>
  );
}
