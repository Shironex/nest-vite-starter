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
