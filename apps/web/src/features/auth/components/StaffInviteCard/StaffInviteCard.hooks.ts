import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Resolver } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from '@repo/ui/sonner';
import { staffInviteAcceptSchema } from '@repo/shared/schemas';
import type { StaffInviteAcceptInput } from '@repo/shared/schemas';
import { AppErrorCode } from '@repo/shared/errors';
import { trpc } from '@/lib/trpc';
import { getAppErrorCode, translateAppError } from '@/lib/trpc-errors';
import type { IStaffInviteCardView, StaffInviteState } from './StaffInviteCard.types';

/** Delay before the redirect to sign-in, so the success toast is readable. */
const REDIRECT_AFTER_ACCEPT_MS = 1500;

/**
 * `/auth/invite/$token`: accept an invitation into an organization.
 *
 * ONE SCREEN for the probe and the form: they have to share one, because the collision path
 * needs the disclosure that accepting CLOSES the reader's current organization to sit
 * beside the password field. Put it on a prior screen and the reader clicks
 * past it, which is the same as not saying it.
 *
 * THE TOKEN IS ROUTE STATE, NOT A PROP, read from the URL so the component
 * never receives a secret as a prop (`props-must-be-visual`). It rides in the
 * request BODY from there, because both procedures are mutations, so the secret
 * never sits in a cacheable GET URL.
 *
 * THE PRE-CHECK DOES NOT CONSUME THE TOKEN, which is what makes it safe on
 * every page load: the invitation is single-use and there is no self-service
 * resend. It is per-IP rate limited server-side, so the effect asks once behind
 * a ref guard.
 *
 * IT SIGNS NOBODY IN. Acceptance mints no session by design, so the new
 * credential goes through the ordinary login path with lockout, the
 * session-epoch fence and the 2FA challenge seam, like every other account.
 * The screen therefore ends at `/auth/login`.
 */
export function useStaffInviteCard(): IStaffInviteCardView {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // `strict: false`: one segment off the invite route, not the whole typed
  // param object.
  const params = useParams({ strict: false }) as { token?: string };
  const token = params.token ?? '';

  const [state, setState] = useState<StaffInviteState>('checking');
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const [movesExistingAccount, setMovesExistingAccount] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isLinkDead, setIsLinkDead] = useState(false);

  const form = useForm<StaffInviteAcceptInput>({
    resolver: zodResolver(staffInviteAcceptSchema) as Resolver<StaffInviteAcceptInput>,
    mode: 'onBlur',
    defaultValues: { token, password: '', factorCode: '' },
  });

  /*
   * The answer is bound to the MUTATION, not to the call, and the ref guard is
   * exactly why it has to be. Guarding the request is not the same as keeping
   * the reply: a per-call `mutate(vars, { onSuccess })` handler runs only while
   * the issuing observer still has listeners, so a remount between the ask and
   * the reply drops it, and the guard that suppresses the second ask then
   * leaves nothing to arrive at all.
   */
  const probe = useMutation({
    ...trpc.auth.staffInviteState.mutationOptions(),
    onSuccess: (data) => {
      setRequiresTwoFactor(data.requiresTwoFactor);
      setMovesExistingAccount(data.movesExistingAccount);
      setState(data.valid ? 'ready' : 'invalid');
    },
    onError: (error) => {
      // A rate-limited probe is a failure to ASK, not a dead link: the budget
      // is per IP, so a shared office address can exhaust it for somebody whose
      // invitation is perfectly good.
      const code = getAppErrorCode(error);
      setState(
        code === AppErrorCode.INVALID_TOKEN || code === AppErrorCode.TOKEN_EXPIRED
          ? 'invalid'
          : 'failed',
      );
    },
  });
  const { mutate: probeMutate } = probe;

  const probedRef = useRef(false);
  useEffect(() => {
    if (probedRef.current) return;
    probedRef.current = true;
    probeMutate({ token });
  }, [token, probeMutate]);

  const acceptMutation = useMutation(trpc.auth.acceptStaffInvite.mutationOptions());

  function onSubmit(data: StaffInviteAcceptInput) {
    setServerError(null);
    acceptMutation.mutate(
      // An empty string is not "no code": the schema accepts it and the server
      // would then treat a blank field as a wrong code rather than as an
      // account with no factor at all.
      {
        ...data,
        ...(data.factorCode ? { factorCode: data.factorCode } : { factorCode: undefined }),
      },
      {
        onSuccess: () => {
          toast.success(t('auth.staffInvite.success'));
          setTimeout(() => {
            void navigate({ to: '/auth/login' });
          }, REDIRECT_AFTER_ACCEPT_MS);
        },
        onError: (error) => {
          const code = getAppErrorCode(error);
          if (code === AppErrorCode.INVALID_TOKEN || code === AppErrorCode.TOKEN_EXPIRED) {
            // No password makes a dead token work, so the form goes away rather
            // than inviting a second attempt at the same link.
            setIsLinkDead(true);
            setServerError(t('auth.staffInvite.invalidLink'));
            return;
          }
          if (code === AppErrorCode.TWO_FACTOR_INVALID_CODE) {
            form.setError('factorCode', { message: t('auth.staffInvite.badCode') });
            return;
          }
          setServerError(translateAppError(error) ?? t('errors.unexpected'));
        },
      },
    );
  }

  return {
    state,
    form,
    onSubmit,
    onRetry: () => {
      setState('checking');
      probeMutate({ token });
    },
    // isSuccess keeps the submit disabled through the delayed redirect.
    isPending: acceptMutation.isPending || acceptMutation.isSuccess,
    password: form.watch('password'),
    requiresTwoFactor,
    movesExistingAccount,
    serverError,
    isLinkDead,
  };
}
