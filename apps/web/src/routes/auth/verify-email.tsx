import { createFileRoute } from '@tanstack/react-router';
// zod/mini: route config (validateSearch) is bundled into the entry chunk by
// the router codegen, and the mini build keeps classic zod out of it.
import * as z from 'zod/mini';
import { pageTitle } from '@/lib/page-title';
import { AuthLayout } from '@/features/auth/components/AuthLayout';
import { VerifyEmail } from '@/features/auth/components/VerifyEmail';

const searchSchema = z.object({
  token: z.optional(z.string()),
  // Set to false by the register flow when the account was created but the
  // verification email could not be sent, so the screen can point at resend.
  emailSent: z.optional(z.boolean()),
});

export const Route = createFileRoute('/auth/verify-email')({
  head: () => pageTitle('pageTitle.verifyEmail'),
  validateSearch: (search) => searchSchema.parse(search),
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  // No title/description here: the heading and its badge change with the
  // verification state, so the feature component owns the page h1.
  return (
    <AuthLayout>
      <VerifyEmail />
    </AuthLayout>
  );
}
