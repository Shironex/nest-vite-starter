import type { TwoFactorStatusOutput } from '@repo/shared/schemas';

export interface ISecurityCardView {
  readonly status: TwoFactorStatusOutput | undefined;
  readonly isLoading: boolean;
  readonly isEnrollOpen: boolean;
  readonly onEnrollOpenChange: (open: boolean) => void;
  readonly onEnrollComplete: () => void;
  readonly isDisableOpen: boolean;
  readonly onDisableOpenChange: (open: boolean) => void;
  readonly isRegenerateOpen: boolean;
  readonly onRegenerateOpenChange: (open: boolean) => void;
  readonly onRevokeTrusted: () => void;
  readonly isRevoking: boolean;
}
