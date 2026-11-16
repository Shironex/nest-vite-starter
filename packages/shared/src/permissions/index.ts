export const PERMISSIONS = {
  MANAGE_USERS: 'manage_users',
  MANAGE_ROLES: 'manage_roles',
  VIEW_ADMIN_PANEL: 'view_admin_panel',
  MANAGE_SETTINGS: 'manage_settings',
  VIEW_AUDIT_LOG: 'view_audit_log',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLES = {
  USER: 'USER',
  ADMIN: 'ADMIN',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

/**
 * Every role value a User row can hold: the Prisma `Role` enum, mirrored here
 * (not imported from @repo/database) because @repo/database is ESM-only and
 * apps/api compiles to CJS. A new role is added here as well as to the enum.
 */

export const ALL_ROLES = [...Object.values(ROLES)] as const;

/** Default role-to-permission mappings (used by seed and permission middleware). */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  USER: [],
  ADMIN: [
    PERMISSIONS.MANAGE_USERS,
    PERMISSIONS.MANAGE_ROLES,
    PERMISSIONS.VIEW_ADMIN_PANEL,
    PERMISSIONS.MANAGE_SETTINGS,
    PERMISSIONS.VIEW_AUDIT_LOG,
  ],
};
