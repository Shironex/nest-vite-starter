export interface IChangeUserRoleDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly targetId: string;
  readonly email: string;
  /** The user's current role, as reported by `user.listUsers`. */
  readonly userRole: string;
}

export interface IChangeUserRoleDialogView {
  readonly currentRoleLabel: string;
  readonly nextRoleLabel: string;
  readonly onConfirm: () => void;
  readonly isPending: boolean;
}
