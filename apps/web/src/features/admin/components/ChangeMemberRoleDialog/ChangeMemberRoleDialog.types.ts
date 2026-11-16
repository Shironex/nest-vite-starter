export interface IChangeMemberRoleDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly memberId: string;
  readonly email: string;
  /** The member's current role, as reported by `user.listUsers`. */
  readonly memberRole: string;
}

export interface IChangeMemberRoleDialogView {
  readonly currentRoleLabel: string;
  readonly nextRoleLabel: string;
  readonly onConfirm: () => void;
  readonly isPending: boolean;
}
