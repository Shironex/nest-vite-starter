export interface IUnlockUserDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly targetId: string;
  readonly email: string;
}

export interface IUnlockUserDialogView {
  readonly onConfirm: () => void;
  readonly isPending: boolean;
}
