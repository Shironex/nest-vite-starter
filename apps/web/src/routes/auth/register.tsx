import { createFileRoute, Link } from '@tanstack/react-router';
import { pageTitle } from '@/lib/page-title';
import { AUTH_LINK_CLASS } from '@/features/auth/Auth.constants';
import { AuthLayout } from '@/features/auth/components/AuthLayout';
import { RegisterForm } from '@/features/auth/components/RegisterForm';
import { authStrings } from '@/features/auth/Auth.strings';
import { commonStrings } from '@/lib/strings';

export const Route = createFileRoute('/auth/register')({
  head: () => pageTitle(commonStrings.pageTitle.register),
  component: RegisterPage,
});

function RegisterPage() {
  return (
    <AuthLayout
      title={authStrings.pages.register.title}
      description={
        <>
          {authStrings.pages.register.haveAccount}{' '}
          <Link to="/auth/login" className={AUTH_LINK_CLASS}>
            {authStrings.pages.register.signIn}
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthLayout>
  );
}
