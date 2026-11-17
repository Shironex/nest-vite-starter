# Recipe: roles and permissions beyond USER and ADMIN

**When you need it:** access depends on more than "admin or not": a support role that can read
users but not change roles, per-feature permissions, or access to a record's owner's team.

## Shape of the change

Start with the smallest step that works and stop there.

- **A new role.** Add the value to the Prisma `Role` enum and to `ROLES` in
  `packages/shared/src/permissions/index.ts` (the shared-enum parity spec fails until both agree),
  migrate, and add a middleware next to `AdminMiddleware` in `modules/auth/middleware/`. Apply it
  with `@UseMiddlewares(AuthMiddleware, SupportMiddleware)` on the procedures that need it. The
  role is stamped into the session at sign-in, so a role change must revoke the account's sessions
  (the admin role-change path and `user:promote` already do).
- **Permissions instead of roles.** Define a `PERMISSIONS` const in `@repo/shared/permissions`, a
  map from role to permission list (a plain object is enough, no table), and a
  `requirePermission('users.read')` middleware factory that reads `ctx.user.role`. Check
  permissions, never role names, in procedures and in the web (`can('users.read')`).
- **Per-record access.** Roles say what a user may do; ownership says to which rows. Keep the
  `where: { id, userId: ctx.user.id }` scoping in the repository for user-owned data, and add a
  membership check in the service for shared data. A middleware cannot know the record.
- **Tables.** Only move permissions into the database when non-developers must edit them at
  runtime. It adds an admin screen, caching and invalidation on every change, and revocation of
  live sessions.

## Pitfalls

- Hiding a link or a button is a courtesy. The middleware on every procedure behind the page is
  the control, and `pnpm lint:meta` only checks that a guard exists, not that it is the right one.
- Test the negative case: a spec per guarded procedure that a lower role gets `FORBIDDEN`
  (`user-role-capability.spec.ts` is the pattern).
- The last-admin and self-demotion guards in the admin role change exist for a reason. Extend them
  when a role can lock people out.
