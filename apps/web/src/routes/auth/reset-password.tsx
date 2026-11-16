import { createFileRoute } from '@tanstack/react-router';
// zod/mini: route config (validateSearch) is bundled into the entry chunk by
// the router codegen, and the mini build keeps classic zod out of it.
import * as z from 'zod/mini';
import { pageTitle } from '@/lib/page-title';
import { AuthLayout } from '@/features/auth/components/AuthLayout';
import { ResetPasswordForm } from '@/features/auth/components/ResetPasswordForm';
import { authStrings } from '@/features/auth/Auth.strings';
import { commonStrings } from '@/lib/strings';

/**
 * `token` is OPTIONAL:
 * `validateSearch` throwing is surfaced by TanStack as a ROUTE ERROR, so a
 * required field answered a mail client that rewrote the link without its
 * query, or somebody who navigated back here after submitting, with an error
 * screen instead of the sentence telling them to open the link from their
 * email. The form reports a missing token itself, in copy.
 */
const searchSchema = z.object({
  token: z.optional(z.string()),
});

export const Route = createFileRoute('/auth/reset-password')({
  head: () => pageTitle(commonStrings.pageTitle.resetPassword),
  validateSearch: (search) => searchSchema.parse(search),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  return (
    <AuthLayout
      title={authStrings.pages.resetPassword.title}
      description={authStrings.pages.resetPassword.description}
    >
      <ResetPasswordForm />
    </AuthLayout>
  );
}
