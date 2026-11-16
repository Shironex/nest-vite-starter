export interface IEnableUserDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly targetId: string;
  readonly email: string;
}

export interface IEnableUserDialogView {
  readonly onConfirm: () => void;
  readonly isPending: boolean;
}
