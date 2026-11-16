export interface IResetMemberDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly memberId: string;
  readonly email: string;
}

export interface IResetMemberDialogView {
  readonly onConfirm: () => void;
  readonly isPending: boolean;
}
