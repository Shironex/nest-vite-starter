import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { AppErrorCode } from '@repo/shared/errors';
import { ROLES } from '@repo/shared/permissions';
import { ForbiddenError, NotFoundError, ValidationError } from '../common/errors';
import { InvariantError } from '../common/errors/invariant-error';
import type { UserRepository } from '../modules/user/user.repository';
import type { SessionService } from '../modules/auth/services/session.service';
import type { AuditService } from '../modules/audit/audit.service';

export interface IPromoteUserDeps {
  users: Pick<UserRepository, 'findByEmail' | 'findForDisable' | 'updateRole'>;
  sessions: Pick<SessionService, 'deleteAllUserSessions'>;
  audit: Pick<AuditService, 'logOrThrow'>;
}

export interface IPromoteUserResult {
  userId: string;
  email: string;
  outcome: 'promoted' | 'already-admin';
}

/**
 * Make an existing account an ADMIN, from a shell on the host.
 *
 * This is how the first admin is made. Signup only ever creates a USER, and
 * the in-app role change is admin-gated, so without this there is no way to get
 * from an empty database to an administrable app. Whoever can run it already
 * holds the database and Redis credentials, so it grants nothing that access
 * did not already allow; what it adds is that the grant is done through the
 * same writes as the in-app role change and leaves the same audit row.
 *
 * Refuses an unknown or deleted address, and a disabled account (enable it
 * first, so the re-admission and the promotion are two separate acts on the
 * record). An account that is already an ADMIN is a no-op and writes nothing.
 *
 * Like `UserService.updateRole`, the account's sessions are revoked after the
 * write: the role is snapshotted into the session at login, so the new role
 * applies at the next sign-in rather than up to 30 days later. The audit row
 * carries the before and after role, like the in-app change.
 */
export async function promoteUser(
  rawEmail: string,
  deps: IPromoteUserDeps,
): Promise<IPromoteUserResult> {
  const email = rawEmail.trim().toLowerCase();
  if (email === '') {
    throw new ValidationError(AppErrorCode.VALIDATION_ERROR, 'An email address is required');
  }

  const user = await deps.users.findByEmail(email);
  if (!user) {
    throw new NotFoundError(undefined, `No live account for ${email}`);
  }
  if (user.role === ROLES.ADMIN) {
    return { userId: user.id, email, outcome: 'already-admin' };
  }

  const state = await deps.users.findForDisable(user.id);
  if (!state) {
    throw new NotFoundError(undefined, `No live account for ${email}`);
  }
  if (state.disabledAt !== null) {
    throw new ForbiddenError(undefined, `${email} is disabled. Enable the account first.`);
  }

  const count = await deps.users.updateRole(user.id, ROLES.ADMIN);
  if (count === 0) {
    // Deleted between the read and the write.
    throw new NotFoundError(undefined, `No live account for ${email}`);
  }

  // Revoke before the audit write, so a failed audit write cannot leave the
  // account on a session that still carries the old role.
  await deps.sessions.deleteAllUserSessions(user.id);

  // logOrThrow, not log: a privilege grant from a shell must not happen
  // without a trace, and if the row cannot be written the operator is told so
  // in as many words rather than shown a success.
  try {
    await deps.audit.logOrThrow({
      action: AUDIT_ACTIONS.USER_ROLE_CHANGED,
      userId: null,
      targetType: 'User',
      targetId: user.id,
      before: { role: state.role },
      after: { role: ROLES.ADMIN },
      reason: 'Promoted from the command line (user:promote)',
      metadata: { via: 'cli' },
    });
  } catch (error) {
    throw new InvariantError(
      `${email} is now an ADMIN, but the audit row could not be written: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }

  return { userId: user.id, email, outcome: 'promoted' };
}
