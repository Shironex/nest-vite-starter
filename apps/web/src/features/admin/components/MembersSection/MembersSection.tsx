import {
  LockOpen,
  MailX,
  MoreHorizontal,
  ShieldOff,
  Trash2,
  UserCog,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
import { InviteMemberDialog } from '../InviteMemberDialog';
import { RemoveMemberDialog } from '../RemoveMemberDialog';
import { ResetMemberDialog } from '../ResetMemberDialog';
import { RestoreMemberDialog } from '../RestoreMemberDialog';
import { RevokeInviteDialog } from '../RevokeInviteDialog';
import { UnlockMemberDialog } from '../UnlockMemberDialog';
import { WithdrawInviteByEmailDialog } from '../WithdrawInviteByEmailDialog';
import { useMembersSection } from './MembersSection.hooks';
import type { Member, MemberDialogKind } from './MembersSection.types';

/** Supporting copy under the heading. */
const MUTED_LINE_CLASS = 'type-body-small text-text-muted';

const SKELETON_KEYS = ['s1', 's2', 's3', 's4', 's5'];

function MemberRow({
  member,
  isSelf,
  now,
  onOpenDialog,
}: {
  member: Member;
  /** Whether this row is the signed-in admin's own account. */
  isSelf: boolean;
  now: number;
  onOpenDialog: (kind: MemberDialogKind, member: Member) => void;
}) {
  const { t } = useTranslation();
  const name = member.displayName ?? '-';
  const roleLabel = t(`admin.roles.${member.role}`, { defaultValue: member.role });
  const twoFactorLabel = member.twoFactorEnabled
    ? t('admin.members.twoFactorEnabled')
    : t('admin.members.twoFactorDisabled');
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
  // `emailVerified` as well as the status: an open invitation is the pair (no
  // password AND an unverified address), and a Google-signup account has no
  // password either. The api derives the status from the pair; reading it
  // again here keeps an older api from ever labeling the owner withdrawable.
  const isPending = member.status === 'pending' && !member.emailVerified;
  const isRemoved = member.status === 'removed';
  // A pending row has never signed in: it has no lockout to clear, no second
  // factor to reset, and nothing to remove. The one thing it can do is stop
  // existing.
  const canManageAccount = !isPending;
  // Withdrawing is a hard delete, so it is never offered on the owner or on
  // the caller's own row, whatever the status says. The api refuses both too;
  // a destructive item that can only fail is still one click from a mistake.
  const canWithdrawInvite = isPending && !member.isOwner && !isSelf;
  const statusLabel = t(`admin.members.status.${member.status}`);
  const statusClass =
    member.status === 'active'
      ? 'bg-success-bg text-success'
      : member.status === 'pending'
        ? 'bg-warning-bg text-warning'
        : 'bg-danger-bg text-danger';

  return (
    <TableRow>
      <TableCell className="type-body-medium">
        {member.email}
        {isLocked && (
          <Badge variant="secondary" className="ml-2 bg-danger-bg text-danger">
            {t('admin.members.locked')}
          </Badge>
        )}
      </TableCell>
      <TableCell>
        {name}
        {member.isOwner && (
          <Badge variant="secondary" className="ml-2">
            {t('admin.members.owner')}
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
              aria-label={t('admin.members.menu.trigger', { email: member.email })}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onOpenDialog('changeRole', member)}>
              <UserCog className="size-4" />
              {t('admin.members.menu.changeRole')}
            </DropdownMenuItem>
            {isLocked && (
              <DropdownMenuItem onClick={() => onOpenDialog('unlock', member)}>
                <LockOpen className="size-4" />
                {t('admin.members.menu.unlock')}
              </DropdownMenuItem>
            )}
            {canManageAccount && (
              <DropdownMenuItem onClick={() => onOpenDialog('resetTwoFactor', member)}>
                <ShieldOff className="size-4" />
                {t('admin.members.menu.resetTwoFactor')}
              </DropdownMenuItem>
            )}
            {isRemoved && (
              <DropdownMenuItem onClick={() => onOpenDialog('restore', member)}>
                <UserPlus className="size-4" />
                {t('admin.members.menu.restore')}
              </DropdownMenuItem>
            )}
            {canRemove && (
              <DropdownMenuItem onClick={() => onOpenDialog('remove', member)}>
                <UserMinus className="size-4" />
                {t('admin.members.menu.remove')}
              </DropdownMenuItem>
            )}
            {canWithdrawInvite && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => onOpenDialog('revokeInvite', member)}
                >
                  <MailX className="size-4" />
                  {t('admin.members.menu.revokeInvite')}
                </DropdownMenuItem>
              </>
            )}
            {canDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => onOpenDialog('delete', member)}
                >
                  <Trash2 className="size-4" />
                  {t('admin.members.menu.delete')}
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
  const { t } = useTranslation();
  const v = useMembersSection();

  const target = v.dialogTarget;
  const resetTarget = target?.kind === 'resetTwoFactor' ? target.member : null;
  const changeRoleTarget = target?.kind === 'changeRole' ? target.member : null;
  const unlockTarget = target?.kind === 'unlock' ? target.member : null;
  const deleteTarget = target?.kind === 'delete' ? target.member : null;
  const removeTarget = target?.kind === 'remove' ? target.member : null;
  const restoreTarget = target?.kind === 'restore' ? target.member : null;
  const revokeInviteTarget = target?.kind === 'revokeInvite' ? target.member : null;
  const rows = v.members.map((member) => (
    <MemberRow
      key={member.id}
      member={member}
      isSelf={member.id === v.currentUserId}
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
            previous: t('pagination.previous'),
            next: t('pagination.next'),
          }}
        />
      </ListSurfaceFooter>
    );

  return (
    <section data-slot="admin-members-section" className="space-y-4">
      {/*
        Card-title scale rather than a hand-picked `text-lg`: this heading sits
        beside `OrgTwoFactorPolicyCard`'s `CardTitle` in the same panel, and the
        two have to read as the same level.
      */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="type-heading-h3 text-text">{t('admin.members.title')}</h2>
          <p className={MUTED_LINE_CLASS}>{t('admin.members.description')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={v.onOpenWithdrawByEmail}>
            <MailX className="size-4" />
            {t('admin.members.withdrawByEmail')}
          </Button>
          <Button type="button" onClick={v.onOpenInvite}>
            <UserPlus className="size-4" />
            {t('admin.members.invite')}
          </Button>
        </div>
      </div>

      <ListSurface
        state={v.state}
        loading={<div className="w-full space-y-3">{skeletons}</div>}
        empty={<p className={MUTED_LINE_CLASS}>{t('admin.members.empty')}</p>}
        error={
          // role="alert" inside: ListSurface wraps its placeholders in a status
          // region and a failed read is not a status.
          <div role="alert" className="space-y-3">
            <p className={MUTED_LINE_CLASS}>{t('admin.members.loadError')}</p>
            <Button variant="outline" size="sm" onClick={v.onRetry}>
              {t('actions.retry')}
            </Button>
          </div>
        }
        footer={footer}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('admin.members.headers.email')}</TableHead>
              <TableHead>{t('admin.members.headers.name')}</TableHead>
              <TableHead>{t('admin.members.headers.role')}</TableHead>
              <TableHead>{t('admin.members.headers.status')}</TableHead>
              <TableHead>{t('admin.members.headers.twoFactor')}</TableHead>
              <TableHead className="text-right">{t('admin.members.headers.actions')}</TableHead>
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

      {revokeInviteTarget && (
        <RevokeInviteDialog
          open
          onOpenChange={v.onCloseDialog}
          memberId={revokeInviteTarget.id}
          email={revokeInviteTarget.email}
        />
      )}

      {v.isInviteOpen && <InviteMemberDialog open onOpenChange={v.onCloseInvite} />}

      {v.isWithdrawByEmailOpen && (
        <WithdrawInviteByEmailDialog open onOpenChange={v.onCloseWithdrawByEmail} />
      )}
    </section>
  );
}
