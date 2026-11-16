import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { pageTitle } from '@/lib/page-title';
import { AUTH_LINK_CLASS } from '@/features/auth/Auth.constants';
import { AuthLayout } from '@/features/auth/components/AuthLayout';
import { RegisterForm } from '@/features/auth/components/RegisterForm';

export const Route = createFileRoute('/auth/register')({
  head: () => pageTitle('pageTitle.register'),
  component: RegisterPage,
});

function RegisterPage() {
  const { t } = useTranslation();
  return (
    <AuthLayout
      title={t('auth.pages.register.title')}
      description={
        <>
          {t('auth.pages.register.haveAccount')}{' '}
          <Link to="/auth/login" className={AUTH_LINK_CLASS}>
            {t('auth.pages.register.signIn')}
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthLayout>
  );
}
