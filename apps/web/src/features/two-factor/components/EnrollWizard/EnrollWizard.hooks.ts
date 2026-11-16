import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from '@repo/ui/sonner';
import {
  twoFactorBeginEnrollmentSchema,
  twoFactorActivateSchema,
  type TwoFactorBeginEnrollmentInput,
  type TwoFactorActivateInput,
} from '@repo/shared/schemas';
import { AppErrorCode } from '@repo/shared/errors';
import { trpc, resetCsrfToken } from '@/lib/trpc';
import { translateAppError } from '@/lib/trpc-errors';
import { getAppErrorCode } from '@/lib/trpc-errors';
import { otpauthUriToQrDataUri } from '@/lib/qr';
import type {
  IEnrollWizardProps,
  IEnrollWizardView,
  TwoFactorEnrollStep,
} from './EnrollWizard.types';

export function useEnrollWizard({ onComplete }: IEnrollWizardProps): IEnrollWizardView {
  const { t } = useTranslation();
  const [step, setStep] = useState<TwoFactorEnrollStep>('password');
  const [qrDataUri, setQrDataUri] = useState<string | null>(null);
  const [secretBase32, setSecretBase32] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[] | null>(null);

  const passwordForm = useForm<TwoFactorBeginEnrollmentInput>({
    resolver: zodResolver(twoFactorBeginEnrollmentSchema),
    mode: 'onBlur',
    defaultValues: { password: '' },
  });
  const confirmForm = useForm<TwoFactorActivateInput>({
    resolver: zodResolver(twoFactorActivateSchema),
    mode: 'onBlur',
    defaultValues: { code: '' },
  });

  const beginMutation = useMutation({
    ...trpc.twoFactor.beginEnrollment.mutationOptions(),
    onSuccess: (data) => {
      setSecretBase32(data.secretBase32);
      // The QR is encoded locally from the otpauth URI, so the secret never
      // leaves the browser over the network.
      setQrDataUri(otpauthUriToQrDataUri(data.otpauthUri));
      setStep('confirm');
    },
    onError: (error) => {
      if (getAppErrorCode(error) === AppErrorCode.INVALID_CREDENTIALS) {
        passwordForm.setError('password', { message: t('twoFactor.enroll.passwordIncorrect') });
      } else {
        toast.error(translateAppError(error) ?? t('twoFactor.enroll.beginFailed'));
      }
    },
  });

  const activateMutation = useMutation({
    ...trpc.twoFactor.activate.mutationOptions(),
    onSuccess: (data) => {
      // activate re-issues the session (dropping any enrollment-required flag);
      // the pre-activate CSRF token is now stale, so reset it before the next
      // authenticated call (e.g. the status refetch behind the settings card).
      resetCsrfToken();
      setRecoveryCodes(data.recoveryCodes);
      setStep('codes');
    },
    onError: (error) => {
      if (getAppErrorCode(error) === AppErrorCode.TWO_FACTOR_INVALID_CODE) {
        confirmForm.setError('code', { message: t('twoFactor.enroll.codeIncorrect') });
      } else {
        toast.error(translateAppError(error) ?? t('twoFactor.enroll.verifyFailed'));
      }
    },
  });

  function onBeginEnrollment(data: TwoFactorBeginEnrollmentInput) {
    beginMutation.mutate(data);
  }

  function onActivate(data: TwoFactorActivateInput) {
    activateMutation.mutate(data);
  }

  function onFinish() {
    onComplete?.();
  }

  return {
    step,
    passwordForm,
    onBeginEnrollment,
    isBeginning: beginMutation.isPending,
    confirmForm,
    onActivate,
    isActivating: activateMutation.isPending,
    qrDataUri,
    secretBase32,
    recoveryCodes,
    onFinish,
  };
}
