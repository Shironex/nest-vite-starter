export interface IRestoreMemberDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly memberId: string;
  readonly email: string;
}

export interface IRestoreMemberDialogView {
  readonly onConfirm: () => void;
  readonly isPending: boolean;
}
