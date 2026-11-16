import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { pageTitle } from '@/lib/page-title';
import { AuthLayout } from '@/features/auth/components/AuthLayout';
import { ForgotPasswordForm } from '@/features/auth/components/ForgotPasswordForm';

export const Route = createFileRoute('/auth/forgot-password')({
  head: () => pageTitle('pageTitle.forgotPassword'),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const { t } = useTranslation();
  return (
    <AuthLayout
      title={t('auth.pages.forgotPassword.title')}
      description={t('auth.pages.forgotPassword.description')}
    >
      <ForgotPasswordForm />
    </AuthLayout>
  );
}
