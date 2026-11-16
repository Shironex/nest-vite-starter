/** English copy for this feature. Interpolated entries are small functions. */
export const adminStrings = {
  members: {
    title: 'Members',
    description: 'Manage member accounts: roles, lockouts, two-factor and account deletion.',
    loadError: 'Failed to load the member list',
    empty: 'No members found.',
    locked: 'Locked',
    headers: {
      email: 'Email',
      name: 'Name',
      role: 'Role',
      twoFactor: 'Two-factor',
      actions: 'Actions',
      status: 'Status',
    },
    twoFactorEnabled: 'Enabled',
    twoFactorDisabled: 'Disabled',
    menu: {
      trigger: ({ email }: { email: string }) => `Actions for ${email}`,
      changeRole: 'Change role',
      unlock: 'Unlock account',
      resetTwoFactor: 'Reset two-factor',
      delete: 'Delete account',
      remove: 'Remove from organization',
      restore: 'Restore to organization',
    },
    pagination: {
      summary: ({ from, to, total }: { from: number; to: number; total: number }) =>
        `Showing ${from}-${to} of ${total}`,
      label: 'Member list pagination',
    },
    owner: 'Owner',
    status: {
      active: 'Active',
      removed: 'Removed from organization',
    },
  },
  roles: {
    ADMIN: 'Administrator',
    USER: 'User',
  },
  resetDialog: {
    title: 'Reset two-factor for this member?',
    description: ({ email }: { email: string }) =>
      `This wipes the two-factor setup for ${email}, forgets their trusted browsers, and signs them out. They must enroll a new authenticator the next time they sign in.`,
    confirm: 'Reset two-factor',
    success: 'Two-factor reset for this member',
    error: 'Could not reset two-factor for this member',
  },
  changeRoleDialog: {
    title: "Change this member's role?",
    description: ({
      email,
      currentRole,
      nextRole,
    }: {
      email: string;
      currentRole: string;
      nextRole: string;
    }) =>
      `The role of ${email} will change from "${currentRole}" to "${nextRole}". The member is signed out and the new role applies from their next sign-in.`,
    confirm: 'Change role',
    success: 'Role changed',
    error: 'Could not change the role',
  },
  unlockDialog: {
    title: 'Unlock this account?',
    description: ({ email }: { email: string }) =>
      `The account ${email} is locked after too many failed sign-in attempts. Unlocking clears the lockout so the member can sign in again right away.`,
    confirm: 'Unlock account',
    success: 'Account unlocked',
    error: 'Could not unlock the account',
  },
  deleteDialog: {
    title: 'Delete this account?',
    description: ({ email }: { email: string }) =>
      `This deletes the account of ${email} entirely, not just its membership in this organization. The member is signed out immediately. This cannot be undone.`,
    confirm: 'Delete account',
    success: 'Account deleted',
    error: 'Could not delete the account',
  },
  removeDialog: {
    title: 'Remove this person from the organization?',
    description: ({ email }: { email: string }) =>
      `${email} loses access to the organization and is signed out immediately. Their account and history stay, and you can restore them at any time.`,
    confirm: 'Remove from organization',
    success: 'Removed from the organization',
    error: 'Could not remove them from the organization',
  },
  restoreDialog: {
    title: 'Restore this person to the organization?',
    description: ({ email }: { email: string }) =>
      `${email} regains access to the organization in the role they held before.`,
    confirm: 'Restore',
    success: 'Restored to the organization',
    error: 'Could not restore them',
  },
} as const;
