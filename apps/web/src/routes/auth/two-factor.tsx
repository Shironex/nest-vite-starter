import { createFileRoute } from '@tanstack/react-router';
import * as z from 'zod/mini';
import { pageTitle } from '@/lib/page-title';
import { AuthLayout } from '@/features/auth/components/AuthLayout';
import { TwoFactorChallenge } from '@/features/two-factor/components/TwoFactorChallenge';

// Same open-redirect guard as the login route: legitimate targets are
// origin-stripped and start with a single '/'.
const safeRedirect = (val: string | undefined): string | undefined =>
  val !== undefined && val.startsWith('/') && !val.startsWith('//') && !val.startsWith('/\\')
    ? val
    : undefined;

const searchSchema = z.object({ redirect: z.optional(z.string()) });

export const Route = createFileRoute('/auth/two-factor')({
  head: () => pageTitle('pageTitle.twoFactor'),
  validateSearch: (search): { redirect?: string } => {
    const redirect = safeRedirect(searchSchema.parse(search).redirect);
    return redirect === undefined ? {} : { redirect };
  },
  component: TwoFactorPage,
});

/**
 * 2FA challenge. Entered when `auth.login` returns `twofa_required`; the
 * `__Host-2fa` pending cookie is already set, so the page needs no query params beyond the post-verify
 * `redirect`. The route is a thin seam: all logic lives in the feature hook.
 */
function TwoFactorPage() {
  // No title/description here: the badge, heading and body copy all change
  // between the authenticator and backup-code modes, so the feature component
  // owns the page h1.
  return (
    <AuthLayout>
      <TwoFactorChallenge />
    </AuthLayout>
  );
}
