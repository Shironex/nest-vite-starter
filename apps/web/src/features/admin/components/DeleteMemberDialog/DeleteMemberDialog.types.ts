export interface IDeleteMemberDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly memberId: string;
  readonly email: string;
}

export interface IDeleteMemberDialogView {
  readonly onConfirm: () => void;
  readonly isPending: boolean;
}
