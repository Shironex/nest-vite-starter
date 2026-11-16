import { FormError } from '@/features/auth/components/FormError';
import { useOAuthErrorAlert } from './OAuthErrorAlert.hooks';

/**
 * SPEC section 9 item 3. The OAuth callback cannot return JSON, so every failure
 * comes back as a full-page redirect to `/auth?error=<code>`; this turns that
 * code into the same destructive banner a failed password login produces.
 *
 * Kept out of OAuthButtons on purpose: the buttons hide themselves when
 * discovery returns nothing, and an error the user needs to read must not
 * disappear along with them.
 */
export default function OAuthErrorAlert() {
  const { message } = useOAuthErrorAlert();

  if (message === null) return null;

  return <FormError>{message}</FormError>;
}
