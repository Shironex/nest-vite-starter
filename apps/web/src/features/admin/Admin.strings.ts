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
      remove: 'Disable account',
      restore: 'Enable account',
    },
    pagination: {
      summary: ({ from, to, total }: { from: number; to: number; total: number }) =>
        `Showing ${from}-${to} of ${total}`,
      label: 'Member list pagination',
    },
    status: {
      active: 'Active',
      disabled: 'Account disabled',
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
      `This deletes the account of ${email} entirely, rather than only disabling it. The member is signed out immediately. This cannot be undone.`,
    confirm: 'Delete account',
    success: 'Account deleted',
    error: 'Could not delete the account',
  },
  removeDialog: {
    title: 'Disable this account?',
    description: ({ email }: { email: string }) =>
      `${email} can no longer sign in and is signed out immediately. Their account and history stay, and you can enable it again at any time.`,
    confirm: 'Disable account',
    success: 'Account disabled',
    error: 'Could not disable the account',
  },
  restoreDialog: {
    title: 'Enable this account?',
    description: ({ email }: { email: string }) =>
      `${email} can sign in again, in the role they held before.`,
    confirm: 'Enable account',
    success: 'Account enabled',
    error: 'Could not enable the account',
  },
} as const;
