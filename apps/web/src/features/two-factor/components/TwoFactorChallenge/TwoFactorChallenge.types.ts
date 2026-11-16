import type { UseFormReturn } from 'react-hook-form';
import type { VerifyTwoFactorInput } from '@repo/shared/schemas';

/**
 * Decorative segment strip drawn behind the real code input.
 * It renders the value the input already holds, so it takes no state of its own.
 */
export interface ICodeSegmentsProps {
  readonly value: string;
}

export interface ITwoFactorChallengeView {
  readonly form: UseFormReturn<VerifyTwoFactorInput>;
  readonly onSubmit: (data: VerifyTwoFactorInput) => void;
  readonly serverError: string | null;
  readonly isPending: boolean;
  /** Backup-code variant is a UI toggle, not a separate procedure. */
  readonly isRecoveryMode: boolean;
  readonly onToggleRecoveryMode: () => void;
}
