import {
  LockOpen,
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
import { ChangeMemberRoleDialog } from '../ChangeMemberRoleDialog';
import { DeleteMemberDialog } from '../DeleteMemberDialog';
import { RemoveMemberDialog } from '../RemoveMemberDialog';
import { ResetMemberDialog } from '../ResetMemberDialog';
import { RestoreMemberDialog } from '../RestoreMemberDialog';
import { UnlockMemberDialog } from '../UnlockMemberDialog';
import { useMembersSection } from './MembersSection.hooks';
import type { Member, MemberDialogKind } from './MembersSection.types';
import { adminStrings } from '@/features/admin/Admin.strings';
import { commonStrings, labelFor } from '@/lib/strings';

/** Supporting copy under the heading. */
const MUTED_LINE_CLASS = 'type-body-small text-text-muted';

const SKELETON_KEYS = ['s1', 's2', 's3', 's4', 's5'];

function MemberRow({
  member,
  now,
  onOpenDialog,
}: {
  member: Member;
  now: number;
  onOpenDialog: (kind: MemberDialogKind, member: Member) => void;
}) {
  const name = member.displayName ?? '-';
  const roleLabel = labelFor(adminStrings.roles, member.role);
  const twoFactorLabel = member.twoFactorEnabled
    ? adminStrings.members.twoFactorEnabled
    : adminStrings.members.twoFactorDisabled;
  // Same tinted-pill language as the 2FA cards above this table.
  const twoFactorClass = member.twoFactorEnabled ? 'bg-success-bg text-success' : undefined;
  const isLocked = member.lockedUntil !== null && new Date(member.lockedUntil).getTime() > now;
  // adminDeleteUser refuses ADMIN targets (and the caller's own account, which
  // is always an admin here), so the menu never offers what the api will deny.
  // The owner is refused by a separate guard and gets the same treatment: a
  // button that always errors is worse than no button.
  const canDelete = member.role !== ROLES.ADMIN && !member.isOwner;
  // removeMember refuses ADMIN targets too, and routes them through demotion.
  const canRemove = member.status === 'active' && member.role !== ROLES.ADMIN && !member.isOwner;
  const isRemoved = member.status === 'removed';
  const statusLabel = adminStrings.members.status[member.status];
  const statusClass =
    member.status === 'active' ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger';

  return (
    <TableRow>
      <TableCell className="type-body-medium">
        {member.email}
        {isLocked && (
          <Badge variant="secondary" className="ml-2 bg-danger-bg text-danger">
            {adminStrings.members.locked}
          </Badge>
        )}
      </TableCell>
      <TableCell>
        {name}
        {member.isOwner && (
          <Badge variant="secondary" className="ml-2">
            {adminStrings.members.owner}
          </Badge>
        )}
      </TableCell>
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
              aria-label={adminStrings.members.menu.trigger({ email: member.email })}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onOpenDialog('changeRole', member)}>
              <UserCog className="size-4" />
              {adminStrings.members.menu.changeRole}
            </DropdownMenuItem>
            {isLocked && (
              <DropdownMenuItem onClick={() => onOpenDialog('unlock', member)}>
                <LockOpen className="size-4" />
                {adminStrings.members.menu.unlock}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => onOpenDialog('resetTwoFactor', member)}>
              <ShieldOff className="size-4" />
              {adminStrings.members.menu.resetTwoFactor}
            </DropdownMenuItem>
            {isRemoved && (
              <DropdownMenuItem onClick={() => onOpenDialog('restore', member)}>
                <UserPlus className="size-4" />
                {adminStrings.members.menu.restore}
              </DropdownMenuItem>
            )}
            {canRemove && (
              <DropdownMenuItem onClick={() => onOpenDialog('remove', member)}>
                <UserMinus className="size-4" />
                {adminStrings.members.menu.remove}
              </DropdownMenuItem>
            )}
            {canDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => onOpenDialog('delete', member)}
                >
                  <Trash2 className="size-4" />
                  {adminStrings.members.menu.delete}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

export default function MembersSection() {
  const v = useMembersSection();

  const target = v.dialogTarget;
  const resetTarget = target?.kind === 'resetTwoFactor' ? target.member : null;
  const changeRoleTarget = target?.kind === 'changeRole' ? target.member : null;
  const unlockTarget = target?.kind === 'unlock' ? target.member : null;
  const deleteTarget = target?.kind === 'delete' ? target.member : null;
  const removeTarget = target?.kind === 'remove' ? target.member : null;
  const restoreTarget = target?.kind === 'restore' ? target.member : null;
  const rows = v.members.map((member) => (
    <MemberRow key={member.id} member={member} now={v.now} onOpenDialog={v.onOpenDialog} />
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
    <section data-slot="admin-members-section" className="space-y-4">
      <div className="space-y-1">
        <h2 className="type-heading-h3 text-text">{adminStrings.members.title}</h2>
        <p className={MUTED_LINE_CLASS}>{adminStrings.members.description}</p>
      </div>

      <ListSurface
        state={v.state}
        loading={<div className="w-full space-y-3">{skeletons}</div>}
        empty={<p className={MUTED_LINE_CLASS}>{adminStrings.members.empty}</p>}
        error={
          // role="alert" inside: ListSurface wraps its placeholders in a status
          // region and a failed read is not a status.
          <div role="alert" className="space-y-3">
            <p className={MUTED_LINE_CLASS}>{adminStrings.members.loadError}</p>
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
              <TableHead>{adminStrings.members.headers.email}</TableHead>
              <TableHead>{adminStrings.members.headers.name}</TableHead>
              <TableHead>{adminStrings.members.headers.role}</TableHead>
              <TableHead>{adminStrings.members.headers.status}</TableHead>
              <TableHead>{adminStrings.members.headers.twoFactor}</TableHead>
              <TableHead className="text-right">{adminStrings.members.headers.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{rows}</TableBody>
        </Table>
      </ListSurface>

      {resetTarget && (
        <ResetMemberDialog
          open
          onOpenChange={v.onCloseDialog}
          memberId={resetTarget.id}
          email={resetTarget.email}
        />
      )}

      {changeRoleTarget && (
        <ChangeMemberRoleDialog
          open
          onOpenChange={v.onCloseDialog}
          memberId={changeRoleTarget.id}
          email={changeRoleTarget.email}
          memberRole={changeRoleTarget.role}
        />
      )}

      {unlockTarget && (
        <UnlockMemberDialog
          open
          onOpenChange={v.onCloseDialog}
          memberId={unlockTarget.id}
          email={unlockTarget.email}
        />
      )}

      {deleteTarget && (
        <DeleteMemberDialog
          open
          onOpenChange={v.onCloseDialog}
          memberId={deleteTarget.id}
          email={deleteTarget.email}
        />
      )}

      {removeTarget && (
        <RemoveMemberDialog
          open
          onOpenChange={v.onCloseDialog}
          memberId={removeTarget.id}
          email={removeTarget.email}
        />
      )}

      {restoreTarget && (
        <RestoreMemberDialog
          open
          onOpenChange={v.onCloseDialog}
          memberId={restoreTarget.id}
          email={restoreTarget.email}
        />
      )}
    </section>
  );
}
