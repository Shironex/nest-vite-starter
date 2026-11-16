export interface IDeleteUserDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly targetId: string;
  readonly email: string;
}

export interface IDeleteUserDialogView {
  readonly onConfirm: () => void;
  readonly isPending: boolean;
}
