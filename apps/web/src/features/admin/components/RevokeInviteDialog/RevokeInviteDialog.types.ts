export interface IRevokeInviteDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly memberId: string;
  readonly email: string;
}

export interface IRevokeInviteDialogView {
  readonly onConfirm: () => void;
  readonly isPending: boolean;
}
