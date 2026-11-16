export interface IUnlockMemberDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly memberId: string;
  readonly email: string;
}

export interface IUnlockMemberDialogView {
  readonly onConfirm: () => void;
  readonly isPending: boolean;
}
