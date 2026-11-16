import type { UseFormReturn } from 'react-hook-form';
import type { ResetPasswordInput } from '@repo/shared/schemas';

export interface IResetPasswordFormView {
  readonly form: UseFormReturn<ResetPasswordInput>;
  readonly onSubmit: (data: ResetPasswordInput) => void;
  readonly serverError: string | null;
  readonly isPending: boolean;
  readonly password: string;
  readonly showRequestNewLink: boolean;
  /**
   * True when the account behind this reset token has an active second factor:
   * the server rejects the reset without a code, so the form must collect one.
   */
  readonly requiresTwoFactor: boolean;
  /**
   * True when the URL carries no reset token at all: a direct visit, or a mail
   * client that rewrote the link. Distinct from a spent or expired token,
   * because the remedy differs (open the email vs request a new link).
   */
  readonly isTokenMissing: boolean;
}
