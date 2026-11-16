import { Link } from '@tanstack/react-router';
import { ArrowLeft, AlertTriangle, CheckCircle, Loader2, Mail, XCircle } from 'lucide-react';
import { Button } from '@repo/ui/button';
import { Form } from '@repo/ui/form';
import { AUTH_MUTED_LINK_CLASS, AUTH_SUBMIT_CLASS } from '@/features/auth/Auth.constants';
import { TurnstileField } from '@/features/auth/components/TurnstileField';
import { AuthSubmit } from '@/features/auth/components/AuthSubmit';
import { FormError } from '@/features/auth/components/FormError';
import { FormSuccess } from '@/features/auth/components/FormSuccess';
import { useCheckYourEmail, useVerifyEmail, useVerifyWithToken } from './VerifyEmail.hooks';
import type { ICheckYourEmailProps, IVerifyEmailStateProps } from './VerifyEmail.types';
import { authStrings } from '@/features/auth/Auth.strings';

/**
 * This screen has NO design of its own. The closest one, the one-time-code
 * screen, confirms an address with a 6-digit code, but the API verifies
 * by emailed link and has no code endpoint, so building that input would be
 * decoration over an endpoint that does not exist. What is borrowed instead is
 * the frame's LAYOUT (centered 48px badge, display heading, muted body), so
 * this screen reads as a sibling of the five that do have designs.
 */
export default function VerifyEmail() {
  const { token, emailSent } = useVerifyEmail();

  if (token) {
    return <VerifyWithToken token={token} />;
  }
  return <CheckYourEmail emailSendFailed={emailSent === false} />;
}

/** Centered badge + heading + body, the shared shape of every state below. */
function VerifyEmailState({
  badgeClass,
  icon,
  title,
  description,
  children,
}: IVerifyEmailStateProps) {
  return (
    <div className="flex flex-col items-center text-center">
      <span
        className={`mb-5 flex size-12 items-center justify-center rounded-xl [&_svg]:size-5 ${badgeClass}`}
      >
        {icon}
      </span>
      <h1 className="type-display-large text-text">{title}</h1>
      <p className="mt-1.5 type-body-regular text-text-muted">{description}</p>
      {children}
    </div>
  );
}

function BackToSignIn() {
  return (
    <Link to="/auth/login" className={`inline-flex items-center gap-1.5 ${AUTH_MUTED_LINK_CLASS}`}>
      <ArrowLeft className="size-3.5" aria-hidden="true" />
      {authStrings.backToSignIn}
    </Link>
  );
}

// Mode 1: auto-verify when arriving from the email link.
function VerifyWithToken({ token }: { token: string }) {
  const { status, errorMessage, retry } = useVerifyWithToken(token);

  if (status === 'loading') {
    return (
      <VerifyEmailState
        badgeClass="bg-brand-tint text-brand-ink"
        icon={<Loader2 className="animate-spin" aria-hidden="true" />}
        title={authStrings.verifyEmail.verifyingTitle}
        description={authStrings.verifyEmail.verifyingDescription}
      />
    );
  }

  // Verifying ends every session of the account, this browser's included
  // (account pre-hijacking: a session opened before the address was proven
  // may not be the owner's), so the only way on is signing in again.
  if (status === 'success') {
    return (
      <VerifyEmailState
        badgeClass="bg-success-bg text-success"
        icon={<CheckCircle aria-hidden="true" />}
        title={authStrings.verifyEmail.verifiedTitle}
        description={authStrings.verifyEmail.verifiedDescription}
      >
        <div className="mt-7 grid w-full gap-2.5">
          <Button asChild className={AUTH_SUBMIT_CLASS}>
            <Link to="/auth/login">{authStrings.verifyEmail.signIn}</Link>
          </Button>
        </div>
      </VerifyEmailState>
    );
  }

  return (
    <VerifyEmailState
      badgeClass="bg-danger-bg text-danger"
      icon={<XCircle aria-hidden="true" />}
      title={authStrings.verifyEmail.failedTitle}
      description={errorMessage}
    >
      <div className="mt-7 grid w-full gap-2.5">
        <Button onClick={retry} className={AUTH_SUBMIT_CLASS}>
          {authStrings.verifyEmail.retry}
        </Button>
        <Button variant="outline" asChild className="h-10.5 w-full rounded-lg">
          <Link to="/auth/verify-email" search={{}}>
            {authStrings.verifyEmail.resend}
          </Link>
        </Button>
      </div>
      <div className="mt-6">
        <BackToSignIn />
      </div>
    </VerifyEmailState>
  );
}

// Mode 2: "check your email" message with a resend option (no token).
function CheckYourEmail({ emailSendFailed }: ICheckYourEmailProps) {
  const {
    form,
    onResend,
    resendSuccess,
    serverError,
    isPending,
    turnstileRef,
    onCaptchaStatusChange,
    captchaStatus,
  } = useCheckYourEmail();

  const resendBlock = (
    <>
      {resendSuccess && (
        <FormSuccess className="mt-7 w-full">{authStrings.verifyEmail.resent}</FormSuccess>
      )}

      {serverError && <FormError className="mt-7 w-full">{serverError}</FormError>}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onResend)} className="mt-7 grid w-full gap-4">
          <TurnstileField
            form={form}
            turnstileRef={turnstileRef}
            onStatusChange={onCaptchaStatusChange}
          />

          <AuthSubmit
            isPending={isPending}
            captchaStatus={captchaStatus}
            variant="outline"
            className="h-10.5 w-full rounded-lg"
          >
            {authStrings.verifyEmail.resend}
          </AuthSubmit>
        </form>
      </Form>

      <div className="mt-6">
        <BackToSignIn />
      </div>
    </>
  );

  if (emailSendFailed) {
    return (
      <VerifyEmailState
        badgeClass="bg-warning-bg text-warning"
        icon={<AlertTriangle aria-hidden="true" />}
        title={authStrings.verifyEmail.sendFailedTitle}
        description={authStrings.verifyEmail.sendFailedDescription}
      >
        {resendBlock}
      </VerifyEmailState>
    );
  }

  return (
    <VerifyEmailState
      badgeClass="bg-brand-tint text-brand-ink"
      icon={<Mail aria-hidden="true" />}
      title={authStrings.verifyEmail.checkInboxTitle}
      description={authStrings.verifyEmail.checkInboxDescription}
    >
      {resendBlock}
    </VerifyEmailState>
  );
}
