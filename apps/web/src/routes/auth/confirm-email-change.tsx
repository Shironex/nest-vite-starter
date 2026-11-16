import { createFileRoute } from '@tanstack/react-router';
// zod/mini: route config (validateSearch) is bundled into the entry chunk by
// the router codegen, and the mini build keeps classic zod out of it.
import * as z from 'zod/mini';
import { pageTitle } from '@/lib/page-title';
import { AuthLayout } from '@/features/auth/components/AuthLayout';
import { ConfirmEmailChange } from '@/features/auth/components/ConfirmEmailChange';
import { commonStrings } from '@/lib/strings';

const searchSchema = z.object({
  token: z.optional(z.string()),
});

export const Route = createFileRoute('/auth/confirm-email-change')({
  head: () => pageTitle(commonStrings.pageTitle.confirmEmailChange),
  validateSearch: (search) => searchSchema.parse(search),
  component: ConfirmEmailChangePage,
});

function ConfirmEmailChangePage() {
  // No title/description here: the heading and its badge change with the
  // confirmation state, so the feature component owns the page h1.
  const { token } = Route.useSearch();
  return (
    <AuthLayout>
      <ConfirmEmailChange token={token} />
    </AuthLayout>
  );
}
