export interface IRevokeSessionsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly targetId: string;
  readonly email: string;
}

export interface IRevokeSessionsDialogView {
  readonly onConfirm: () => void;
  readonly isPending: boolean;
}
