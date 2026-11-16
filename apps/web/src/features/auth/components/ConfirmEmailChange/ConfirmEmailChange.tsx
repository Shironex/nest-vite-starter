import { Link } from '@tanstack/react-router';
import { CheckCircle, Loader2, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@repo/ui/button';
import { AUTH_SUBMIT_CLASS } from '@/features/auth/Auth.constants';
import { useConfirmEmailChange } from './ConfirmEmailChange.hooks';
import type { IConfirmEmailChangeStateProps } from './ConfirmEmailChange.types';

/**
 * Landing screen for the link mailed to the NEW address. Borrows VerifyEmail's
 * layout (centered 48px badge, display heading, muted body) so the two
 * link-consuming screens read as siblings. There is no signed-in assumption:
 * the api revokes every session on success, so the only onward route is
 * sign-in with the new address.
 */
export default function ConfirmEmailChange({ token }: { token: string | undefined }) {
  const { t } = useTranslation();

  if (token === undefined || token === '') {
    return (
      <ConfirmEmailChangeState
        badgeClass="bg-danger-bg text-danger"
        icon={<XCircle aria-hidden="true" />}
        title={t('auth.emailChange.confirm.errorTitle')}
        description={t('auth.emailChange.confirm.missingToken')}
      >
        <GoToLogin />
      </ConfirmEmailChangeState>
    );
  }
  return <ConfirmWithToken token={token} />;
}

/** Centered badge + heading + body, the shared shape of every state below. */
function ConfirmEmailChangeState({
  badgeClass,
  icon,
  title,
  description,
  children,
}: IConfirmEmailChangeStateProps) {
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

function GoToLogin() {
  const { t } = useTranslation();
  return (
    <div className="mt-7 grid w-full gap-2.5">
      <Button asChild className={AUTH_SUBMIT_CLASS}>
        <Link to="/auth/login">{t('auth.emailChange.confirm.goToLogin')}</Link>
      </Button>
    </div>
  );
}

function ConfirmWithToken({ token }: { token: string }) {
  const { t } = useTranslation();
  const { status, errorMessage, retry } = useConfirmEmailChange(token);

  if (status === 'loading') {
    return (
      <ConfirmEmailChangeState
        badgeClass="bg-brand-tint text-brand-ink"
        icon={<Loader2 className="animate-spin" aria-hidden="true" />}
        title={t('auth.emailChange.confirm.loadingTitle')}
        description={t('auth.emailChange.confirm.loadingDescription')}
      />
    );
  }

  if (status === 'success') {
    return (
      <ConfirmEmailChangeState
        badgeClass="bg-success-bg text-success"
        icon={<CheckCircle aria-hidden="true" />}
        title={t('auth.emailChange.confirm.successTitle')}
        description={t('auth.emailChange.confirm.successDescription')}
      >
        <GoToLogin />
      </ConfirmEmailChangeState>
    );
  }

  return (
    <ConfirmEmailChangeState
      badgeClass="bg-danger-bg text-danger"
      icon={<XCircle aria-hidden="true" />}
      title={t('auth.emailChange.confirm.errorTitle')}
      description={errorMessage}
    >
      <div className="mt-7 grid w-full gap-2.5">
        <Button onClick={retry} className={AUTH_SUBMIT_CLASS}>
          {t('auth.emailChange.confirm.retry')}
        </Button>
        <Button variant="outline" asChild className="h-10.5 w-full rounded-lg">
          <Link to="/auth/login">{t('auth.emailChange.confirm.goToLogin')}</Link>
        </Button>
      </div>
    </ConfirmEmailChangeState>
  );
}
