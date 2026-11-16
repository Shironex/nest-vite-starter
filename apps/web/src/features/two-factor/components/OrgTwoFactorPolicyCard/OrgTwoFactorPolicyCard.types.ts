import type { TenantTwoFactorPolicyOutput } from '@repo/shared/schemas';

export interface IOrgTwoFactorPolicyCardView {
  readonly policy: TenantTwoFactorPolicyOutput | undefined;
  readonly isLoading: boolean;
  readonly required: boolean;
  readonly enforced: boolean;
  /** "Required for all members" / "Not required". */
  readonly statusText: string;
  /** "Members must enroll by <date>", or null when 2FA is not required. */
  readonly deadlineText: string | null;
  readonly confirmEnableOpen: boolean;
  readonly onConfirmEnableOpenChange: (open: boolean) => void;
  /** Switch handler: turning on asks for confirmation, turning off applies now. */
  readonly onToggle: (next: boolean) => void;
  readonly onConfirmEnable: () => void;
  readonly isPending: boolean;
}
