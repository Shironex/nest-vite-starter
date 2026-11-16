import { createFileRoute } from '@tanstack/react-router';
import { pageTitle } from '@/lib/page-title';
import { AuthLayout } from '@/features/auth/components/AuthLayout';
import { ForgotPasswordForm } from '@/features/auth/components/ForgotPasswordForm';
import { authStrings } from '@/features/auth/Auth.strings';
import { commonStrings } from '@/lib/strings';

export const Route = createFileRoute('/auth/forgot-password')({
  head: () => pageTitle(commonStrings.pageTitle.forgotPassword),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  return (
    <AuthLayout
      title={authStrings.pages.forgotPassword.title}
      description={authStrings.pages.forgotPassword.description}
    >
      <ForgotPasswordForm />
    </AuthLayout>
  );
}
