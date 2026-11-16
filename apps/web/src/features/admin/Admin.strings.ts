/** English copy for this feature. Interpolated entries are small functions. */
export const adminStrings = {
  page: {
    loadError: 'Could not load the admin page',
  },
  users: {
    title: 'Users',
    description:
      'Manage user accounts: roles, sessions, lockouts, two-factor, disabling and deletion.',
    loadError: 'Failed to load the user list',
    empty: 'No users found.',
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
      disable: 'Disable account',
      enable: 'Enable account',
      revokeSessions: 'Sign out everywhere',
    },
    you: 'You',
    pagination: {
      summary: ({ from, to, total }: { from: number; to: number; total: number }) =>
        `Showing ${from}-${to} of ${total}`,
      label: 'User list pagination',
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
    title: 'Reset two-factor for this user?',
    description: ({ email }: { email: string }) =>
      `This wipes the two-factor setup for ${email}, forgets their trusted browsers, and signs them out. They must enroll a new authenticator the next time they sign in.`,
    confirm: 'Reset two-factor',
    success: 'Two-factor reset for this user',
    error: 'Could not reset two-factor for this user',
  },
  changeRoleDialog: {
    title: "Change this user's role?",
    description: ({
      email,
      currentRole,
      nextRole,
    }: {
      email: string;
      currentRole: string;
      nextRole: string;
    }) =>
      `The role of ${email} will change from "${currentRole}" to "${nextRole}". The user is signed out and the new role applies from their next sign-in.`,
    confirm: 'Change role',
    success: 'Role changed',
    error: 'Could not change the role',
  },
  unlockDialog: {
    title: 'Unlock this account?',
    description: ({ email }: { email: string }) =>
      `The account ${email} is locked after too many failed sign-in attempts. Unlocking clears the lockout so the user can sign in again right away.`,
    confirm: 'Unlock account',
    success: 'Account unlocked',
    error: 'Could not unlock the account',
  },
  deleteDialog: {
    title: 'Delete this account?',
    description: ({ email }: { email: string }) =>
      `This deletes the account of ${email} entirely, rather than only disabling it. The user is signed out immediately. This cannot be undone.`,
    confirm: 'Delete account',
    success: 'Account deleted',
    error: 'Could not delete the account',
  },
  disableDialog: {
    title: 'Disable this account?',
    description: ({ email }: { email: string }) =>
      `${email} can no longer sign in and is signed out immediately. Their account and history stay, and you can enable it again at any time.`,
    confirm: 'Disable account',
    success: 'Account disabled',
    error: 'Could not disable the account',
  },
  enableDialog: {
    title: 'Enable this account?',
    description: ({ email }: { email: string }) =>
      `${email} can sign in again, in the role they held before.`,
    confirm: 'Enable account',
    success: 'Account enabled',
    error: 'Could not enable the account',
  },
  revokeSessionsDialog: {
    title: 'Sign this user out everywhere?',
    description: ({ email }: { email: string }) =>
      `Every session of ${email} ends now, on every device. Their account, role and two-factor stay as they are, and they can sign in again right away.`,
    confirm: 'Sign out everywhere',
    success: 'User signed out everywhere',
    error: 'Could not sign the user out',
  },
  audit: {
    title: 'Audit log',
    description: 'Who did what, newest first. Read-only.',
    empty: 'The audit log is still empty',
    loadError: 'Could not load the audit log',
    systemActor: 'System',
    columns: {
      when: 'When',
      actor: 'User',
      action: 'Event',
      target: 'Concerns',
    },
    pagination: {
      summary: ({ from, to }: { from: number; to: number }) => `Showing ${from}-${to}`,
      label: 'Audit log pagination',
    },
    targetTypes: {
      User: 'User',
      AuditLog: 'Audit log',
    },
    actions: {
      audit_retention_sweep: 'Audit-log retention sweep',
      auth_2fa_admin_reset: 'Two-factor reset by an administrator',
      auth_2fa_challenge_failure: 'Failed two-factor verification',
      auth_2fa_challenge_success: 'Successful two-factor verification',
      auth_2fa_disabled: 'Two-factor disabled',
      auth_2fa_enabled: 'Two-factor enabled',
      auth_2fa_enroll_begin: 'Two-factor setup started',
      auth_2fa_locked: 'Two-factor verification locked',
      auth_2fa_recovery_regenerated: 'Recovery codes regenerated',
      auth_2fa_recovery_used: 'Recovery code used',
      auth_2fa_support_reset: 'Two-factor reset by support',
      auth_2fa_trust_revoked: 'Device trust revoked',
      auth_email_change_requested: 'Email change requested',
      auth_email_changed: 'Email address changed',
      auth_email_verification_resent: 'Verification email resent',
      auth_email_verified: 'Email address verified',
      auth_lockout_admin_cleared: 'Lockout cleared by an administrator',
      auth_login_failure: 'Failed sign-in',
      auth_login_locked: 'Sign-in attempt on a locked account',
      auth_login_success: 'Successful sign-in',
      auth_logout: 'Signed out',
      auth_logout_all: 'Signed out of all sessions',
      auth_logout_others: 'Signed out of other sessions',
      auth_password_change: 'Password changed',
      auth_password_forgot: 'Password reset requested',
      auth_password_reset: 'Password reset',
      auth_register_success: 'Account registered',
      auth_session_revoked: 'Session revoked',
      data_export_downloaded: 'Data export downloaded',
      user_account_admin_deleted: 'Account deleted by an administrator',
      user_account_deleted: 'Own account deleted',
      user_account_disabled: 'Account disabled by an administrator',
      user_account_enabled: 'Account enabled by an administrator',
      user_account_purged: 'Account permanently purged after the grace period',
      user_role_changed: 'Role changed',
      user_sessions_revoked: 'Signed out of every session by an administrator',
    },
  },
} as const;
