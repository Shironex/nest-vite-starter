import { createFileRoute, Link } from '@tanstack/react-router';
// zod/mini: route config (validateSearch) is bundled into the entry chunk by
// the router codegen, and the mini build keeps classic zod out of it.
import * as z from 'zod/mini';
import { useTranslation } from 'react-i18next';
import { pageTitle } from '@/lib/page-title';
import { AUTH_LINK_CLASS } from '@/features/auth/Auth.constants';
import { AuthLayout } from '@/features/auth/components/AuthLayout';
import { LoginForm } from '@/features/auth/components/LoginForm';

/**
 * Open-redirect guard for the post-login redirect target. The producer
 * (_authenticated beforeLoad) passes TanStack's `location.href`, which is
 * origin-stripped (pathname + search + hash), so legitimate values always
 * start with a single '/'. Anything else ('//evil.com', '/\\evil.com',
 * 'https://evil.com') is dropped to undefined (falls back to /dashboard)
 * instead of throwing, so a tampered URL still renders the login page.
 */
const safeRedirect = (val: string | undefined): string | undefined =>
  val !== undefined && val.startsWith('/') && !val.startsWith('//') && !val.startsWith('/\\')
    ? val
    : undefined;

const searchSchema = z.object({
  redirect: z.optional(z.string()),
});

export const Route = createFileRoute('/auth/login')({
  head: () => pageTitle('pageTitle.signIn'),
  // The explicit `{ redirect?: string }` return keeps the key OPTIONAL in the
  // route's search type (a zod .transform would make it a required
  // `string | undefined` key and force `search` on every Link to this route).
  validateSearch: (search): { redirect?: string } => {
    const redirect = safeRedirect(searchSchema.parse(search).redirect);
    return redirect === undefined ? {} : { redirect };
  },
  component: LoginPage,
});

function LoginPage() {
  const { t } = useTranslation();
  return (
    <AuthLayout
      title={t('auth.pages.login.title')}
      description={
        <>
          {t('auth.pages.login.noAccount')}{' '}
          <Link to="/auth/register" className={AUTH_LINK_CLASS}>
            {t('auth.pages.login.register')}
          </Link>
        </>
      }
    >
      <LoginForm />
    </AuthLayout>
  );
}
