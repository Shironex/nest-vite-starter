export interface IRemoveMemberDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly memberId: string;
  readonly email: string;
}

export interface IRemoveMemberDialogView {
  readonly onConfirm: () => void;
  readonly isPending: boolean;
}
