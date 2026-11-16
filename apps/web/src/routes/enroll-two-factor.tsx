import { createFileRoute, redirect } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { pageTitle } from '@/lib/page-title';
import { trpc, isUnauthorizedError } from '@/lib/trpc';
import { AuthLayout } from '@/features/auth/components/AuthLayout';
import { EnrollOnlyScreen } from '@/features/two-factor/components/EnrollOnlyScreen';

/**
 * Enroll-only screen for a member whose tenant now enforces 2FA past its grace
 * window. It lives OUTSIDE `_authenticated` on purpose: that layout's `user.me`
 * guard 403s for a flagged session and would redirect here, so nesting would
 * loop. `twoFactor.status` is on the middleware allowlist, so this guard still
 * resolves for the flagged session. The server allowlist is the real boundary.
 */
export const Route = createFileRoute('/enroll-two-factor')({
  head: () => pageTitle('pageTitle.enrollTwoFactor'),
  beforeLoad: async ({ context }) => {
    let status;
    try {
      status = await context.queryClient.ensureQueryData({
        ...trpc.twoFactor.status.queryOptions(),
        retry: false,
      });
    } catch (error) {
      if (isUnauthorizedError(error)) {
        throw redirect({ to: '/auth/login', search: { redirect: '/enroll-two-factor' } });
      }
      throw error;
    }
    // Nothing to enroll: the tenant does not require 2FA, or this user already
    // has a factor. Send them into the app.
    if (!status.policy.required || status.enabled) {
      throw redirect({ to: '/dashboard' });
    }
  },
  component: EnrollTwoFactorPage,
});

function EnrollTwoFactorPage() {
  const { t } = useTranslation();
  return (
    <AuthLayout
      title={t('twoFactor.enrollOnly.pageTitle')}
      description={t('twoFactor.enrollOnly.pageDescription')}
    >
      <EnrollOnlyScreen />
    </AuthLayout>
  );
}
