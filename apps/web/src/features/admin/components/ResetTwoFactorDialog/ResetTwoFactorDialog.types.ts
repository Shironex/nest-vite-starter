export interface IResetTwoFactorDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly targetId: string;
  readonly email: string;
}

export interface IResetTwoFactorDialogView {
  readonly onConfirm: () => void;
  readonly isPending: boolean;
}
