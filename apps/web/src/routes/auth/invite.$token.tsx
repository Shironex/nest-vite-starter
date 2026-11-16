import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { pageTitle } from '@/lib/page-title';
import { AuthLayout } from '@/features/auth/components/AuthLayout';
import { StaffInviteCard } from '@/features/auth/components/StaffInviteCard';

/**
 * `/auth/invite/$token`: the link a staff invitation mail sends.
 *
 * THE PATH IS FIXED BY THE API, which mints `${appUrl}/auth/invite/${rawToken}`
 * (`StaffInviteService`), so the token is a path segment here. It rides the
 * request BODY when it reaches the server, because both procedures are
 * mutations and a secret must not sit in a cacheable GET URL.
 *
 * PUBLIC, and it has to be: the reader has no session and, on the ordinary
 * path, no password either. It sits outside the `_shell` layout for that
 * reason.
 *
 * ONE ROUTE for the probe and the form. The collision path needs the disclosure that accepting closes the
 * reader's current organization to sit beside the password field; on a prior screen it
 * would be something they clicked past.
 */
export const Route = createFileRoute('/auth/invite/$token')({
  head: () => pageTitle('pageTitle.staffInvite'),
  component: StaffInvitePage,
});

function StaffInvitePage() {
  const { t } = useTranslation();
  return (
    <AuthLayout title={t('auth.staffInvite.title')} description={t('auth.staffInvite.description')}>
      <StaffInviteCard />
    </AuthLayout>
  );
}
