import {
  LockOpen,
  LogOut,
  MoreHorizontal,
  ShieldOff,
  Trash2,
  UserCog,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import { Badge } from '@repo/ui/badge';
import { Button } from '@repo/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@repo/ui/dropdown-menu';
import { ListSurface, ListSurfaceFooter } from '@repo/ui/list-surface';
import { Pagination } from '@repo/ui/pagination';
import { Skeleton } from '@repo/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/table';
import { ROLES } from '@repo/shared/permissions';
import { ChangeUserRoleDialog } from '../ChangeUserRoleDialog';
import { DeleteUserDialog } from '../DeleteUserDialog';
import { DisableUserDialog } from '../DisableUserDialog';
import { ResetTwoFactorDialog } from '../ResetTwoFactorDialog';
import { EnableUserDialog } from '../EnableUserDialog';
import { RevokeSessionsDialog } from '../RevokeSessionsDialog';
import { UnlockUserDialog } from '../UnlockUserDialog';
import { useUsersSection } from './UsersSection.hooks';
import type { AdminUser, AdminUserDialogKind } from './UsersSection.types';
import { adminStrings } from '@/features/admin/Admin.strings';
import { commonStrings, labelFor } from '@/lib/strings';

/** Supporting copy under the heading. */
const MUTED_LINE_CLASS = 'type-body-small text-text-muted';

const SKELETON_KEYS = ['s1', 's2', 's3', 's4', 's5'];

function AdminUserRow({
  user,
  isSelf,
  now,
  onOpenDialog,
}: {
  user: AdminUser;
  isSelf: boolean;
  now: number;
  onOpenDialog: (kind: AdminUserDialogKind, user: AdminUser) => void;
}) {
  const name = user.displayName ?? '-';
  const roleLabel = labelFor(adminStrings.roles, user.role);
  const twoFactorLabel = user.twoFactorEnabled
    ? adminStrings.users.twoFactorEnabled
    : adminStrings.users.twoFactorDisabled;
  // Same tinted-pill language as the 2FA cards above this table.
  const twoFactorClass = user.twoFactorEnabled ? 'bg-success-bg text-success' : undefined;
  const isLocked = user.lockedUntil !== null && new Date(user.lockedUntil).getTime() > now;
  // The menu never offers what the api will deny: a button that always errors
  // is worse than no button. Every act on the caller's own account is refused
  // (self guard). adminDeleteUser and disableUser also refuse ADMIN targets,
  // which routes them through demotion and its last-admin guard.
  const canChangeRole = !isSelf;
  const canRevokeSessions = !isSelf;
  const canResetTwoFactor = !isSelf;
  const canDelete = !isSelf && user.role !== ROLES.ADMIN;
  const canDisable = !isSelf && user.status === 'active' && user.role !== ROLES.ADMIN;
  const isDisabled = user.status === 'disabled';
  const statusLabel = adminStrings.users.status[user.status];
  const statusClass =
    user.status === 'active' ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger';

  return (
    <TableRow>
      <TableCell className="type-body-medium">
        {user.email}
        {isSelf && (
          <Badge variant="secondary" className="ml-2">
            {adminStrings.users.you}
          </Badge>
        )}
        {isLocked && (
          <Badge variant="secondary" className="ml-2 bg-danger-bg text-danger">
            {adminStrings.users.locked}
          </Badge>
        )}
      </TableCell>
      <TableCell>{name}</TableCell>
      <TableCell>{roleLabel}</TableCell>
      <TableCell>
        <Badge variant="secondary" className={statusClass}>
          {statusLabel}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge variant="secondary" className={twoFactorClass}>
          {twoFactorLabel}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={adminStrings.users.menu.trigger({ email: user.email })}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canChangeRole && (
              <DropdownMenuItem onClick={() => onOpenDialog('changeRole', user)}>
                <UserCog className="size-4" />
                {adminStrings.users.menu.changeRole}
              </DropdownMenuItem>
            )}
            {canRevokeSessions && (
              <DropdownMenuItem onClick={() => onOpenDialog('revokeSessions', user)}>
                <LogOut className="size-4" />
                {adminStrings.users.menu.revokeSessions}
              </DropdownMenuItem>
            )}
            {isLocked && (
              <DropdownMenuItem onClick={() => onOpenDialog('unlock', user)}>
                <LockOpen className="size-4" />
                {adminStrings.users.menu.unlock}
              </DropdownMenuItem>
            )}
            {canResetTwoFactor && (
              <DropdownMenuItem onClick={() => onOpenDialog('resetTwoFactor', user)}>
                <ShieldOff className="size-4" />
                {adminStrings.users.menu.resetTwoFactor}
              </DropdownMenuItem>
            )}
            {isDisabled && (
              <DropdownMenuItem onClick={() => onOpenDialog('enable', user)}>
                <UserPlus className="size-4" />
                {adminStrings.users.menu.enable}
              </DropdownMenuItem>
            )}
            {canDisable && (
              <DropdownMenuItem onClick={() => onOpenDialog('disable', user)}>
                <UserMinus className="size-4" />
                {adminStrings.users.menu.disable}
              </DropdownMenuItem>
            )}
            {canDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => onOpenDialog('delete', user)}
                >
                  <Trash2 className="size-4" />
                  {adminStrings.users.menu.delete}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

export default function UsersSection() {
  const v = useUsersSection();

  const target = v.dialogTarget;
  const resetTarget = target?.kind === 'resetTwoFactor' ? target.user : null;
  const changeRoleTarget = target?.kind === 'changeRole' ? target.user : null;
  const unlockTarget = target?.kind === 'unlock' ? target.user : null;
  const deleteTarget = target?.kind === 'delete' ? target.user : null;
  const disableTarget = target?.kind === 'disable' ? target.user : null;
  const enableTarget = target?.kind === 'enable' ? target.user : null;
  const revokeSessionsTarget = target?.kind === 'revokeSessions' ? target.user : null;
  const rows = v.users.map((user) => (
    <AdminUserRow
      key={user.id}
      user={user}
      isSelf={user.id === v.currentUserId}
      now={v.now}
      onOpenDialog={v.onOpenDialog}
    />
  ));
  const skeletons = SKELETON_KEYS.map((key) => <Skeleton key={key} className="h-10 w-full" />);

  const footer =
    v.pagination === null ? undefined : (
      <ListSurfaceFooter>
        <Pagination
          hasPrevious={v.pagination.hasPrevious}
          hasNext={v.pagination.hasNext}
          onPrevious={v.pagination.onPrevious}
          onNext={v.pagination.onNext}
          labels={{
            summary: v.pagination.summary,
            label: v.pagination.label,
            previous: commonStrings.pagination.previous,
            next: commonStrings.pagination.next,
          }}
        />
      </ListSurfaceFooter>
    );

  return (
    <section data-slot="admin-users-section" className="space-y-4">
      <div className="space-y-1">
        <h2 className="type-heading-h3 text-text">{adminStrings.users.title}</h2>
        <p className={MUTED_LINE_CLASS}>{adminStrings.users.description}</p>
      </div>

      <ListSurface
        state={v.state}
        loading={<div className="w-full space-y-3">{skeletons}</div>}
        empty={<p className={MUTED_LINE_CLASS}>{adminStrings.users.empty}</p>}
        error={
          // role="alert" inside: ListSurface wraps its placeholders in a status
          // region and a failed read is not a status.
          <div role="alert" className="space-y-3">
            <p className={MUTED_LINE_CLASS}>{adminStrings.users.loadError}</p>
            <Button variant="outline" size="sm" onClick={v.onRetry}>
              {commonStrings.actions.retry}
            </Button>
          </div>
        }
        footer={footer}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{adminStrings.users.headers.email}</TableHead>
              <TableHead>{adminStrings.users.headers.name}</TableHead>
              <TableHead>{adminStrings.users.headers.role}</TableHead>
              <TableHead>{adminStrings.users.headers.status}</TableHead>
              <TableHead>{adminStrings.users.headers.twoFactor}</TableHead>
              <TableHead className="text-right">{adminStrings.users.headers.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{rows}</TableBody>
        </Table>
      </ListSurface>

      {resetTarget && (
        <ResetTwoFactorDialog
          open
          onOpenChange={v.onCloseDialog}
          targetId={resetTarget.id}
          email={resetTarget.email}
        />
      )}

      {changeRoleTarget && (
        <ChangeUserRoleDialog
          open
          onOpenChange={v.onCloseDialog}
          targetId={changeRoleTarget.id}
          email={changeRoleTarget.email}
          userRole={changeRoleTarget.role}
        />
      )}

      {unlockTarget && (
        <UnlockUserDialog
          open
          onOpenChange={v.onCloseDialog}
          targetId={unlockTarget.id}
          email={unlockTarget.email}
        />
      )}

      {deleteTarget && (
        <DeleteUserDialog
          open
          onOpenChange={v.onCloseDialog}
          targetId={deleteTarget.id}
          email={deleteTarget.email}
        />
      )}

      {disableTarget && (
        <DisableUserDialog
          open
          onOpenChange={v.onCloseDialog}
          targetId={disableTarget.id}
          email={disableTarget.email}
        />
      )}

      {enableTarget && (
        <EnableUserDialog
          open
          onOpenChange={v.onCloseDialog}
          targetId={enableTarget.id}
          email={enableTarget.email}
        />
      )}
      {revokeSessionsTarget && (
        <RevokeSessionsDialog
          open
          onOpenChange={v.onCloseDialog}
          targetId={revokeSessionsTarget.id}
          email={revokeSessionsTarget.email}
        />
      )}
    </section>
  );
}
