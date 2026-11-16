export interface IDisableUserDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly targetId: string;
  readonly email: string;
}

export interface IDisableUserDialogView {
  readonly onConfirm: () => void;
  readonly isPending: boolean;
}
