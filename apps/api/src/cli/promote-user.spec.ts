import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { promoteUser, type IPromoteUserDeps } from './promote-user';

const buildDeps = () => {
  const users = {
    findByEmail: jest.fn().mockResolvedValue({ id: 'u-1', role: 'USER' }),
    findForDisable: jest.fn().mockResolvedValue({ id: 'u-1', role: 'USER', disabledAt: null }),
    updateRole: jest.fn().mockResolvedValue(1),
  };
  const sessions = { deleteAllUserSessions: jest.fn().mockResolvedValue(undefined) };
  const audit = { logOrThrow: jest.fn().mockResolvedValue(undefined) };
  return {
    users,
    sessions,
    audit,
    deps: { users, sessions, audit } as unknown as IPromoteUserDeps,
  };
};

describe('promoteUser', () => {
  it('normalizes the address, writes the role, revokes the sessions, then audits', async () => {
    const { users, sessions, audit, deps } = buildDeps();

    await expect(promoteUser('  Someone@Example.com ', deps)).resolves.toEqual({
      userId: 'u-1',
      email: 'someone@example.com',
      outcome: 'promoted',
    });

    expect(users.findByEmail).toHaveBeenCalledWith('someone@example.com');
    expect(users.updateRole).toHaveBeenCalledWith('u-1', 'ADMIN');
    expect(audit.logOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.USER_ROLE_CHANGED,
        userId: null,
        targetType: 'User',
        targetId: 'u-1',
        before: { role: 'USER' },
        after: { role: 'ADMIN' },
        metadata: { via: 'cli' },
      }),
    );
    expect(sessions.deleteAllUserSessions).toHaveBeenCalledWith('u-1');
    // Write, then the teardown, then the trail.
    expect(users.updateRole.mock.invocationCallOrder[0]!).toBeLessThan(
      sessions.deleteAllUserSessions.mock.invocationCallOrder[0]!,
    );
    expect(sessions.deleteAllUserSessions.mock.invocationCallOrder[0]!).toBeLessThan(
      audit.logOrThrow.mock.invocationCallOrder[0]!,
    );
  });

  it('is a no-op for an account that is already an ADMIN', async () => {
    const { users, sessions, audit, deps } = buildDeps();
    users.findByEmail.mockResolvedValue({ id: 'u-1', role: 'ADMIN' });

    await expect(promoteUser('a@example.com', deps)).resolves.toMatchObject({
      outcome: 'already-admin',
    });
    expect(users.updateRole).not.toHaveBeenCalled();
    expect(audit.logOrThrow).not.toHaveBeenCalled();
    expect(sessions.deleteAllUserSessions).not.toHaveBeenCalled();
  });

  it('refuses an unknown or deleted address', async () => {
    const { users, deps } = buildDeps();
    users.findByEmail.mockResolvedValue(null);

    await expect(promoteUser('ghost@example.com', deps)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(users.updateRole).not.toHaveBeenCalled();
  });

  it('refuses a disabled account', async () => {
    const { users, audit, deps } = buildDeps();
    users.findForDisable.mockResolvedValue({ id: 'u-1', role: 'USER', disabledAt: new Date() });

    await expect(promoteUser('a@example.com', deps)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(users.updateRole).not.toHaveBeenCalled();
    expect(audit.logOrThrow).not.toHaveBeenCalled();
  });

  it('refuses an empty address before reading anything', async () => {
    const { users, deps } = buildDeps();

    await expect(promoteUser('   ', deps)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(users.findByEmail).not.toHaveBeenCalled();
  });

  it('throws and audits nothing when the row vanished before the write', async () => {
    const { users, audit, sessions, deps } = buildDeps();
    users.updateRole.mockResolvedValue(0);

    await expect(promoteUser('a@example.com', deps)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(audit.logOrThrow).not.toHaveBeenCalled();
    expect(sessions.deleteAllUserSessions).not.toHaveBeenCalled();
  });

  it('says plainly that the role changed when only the audit write failed', async () => {
    const { audit, sessions, deps } = buildDeps();
    audit.logOrThrow.mockRejectedValue(new Error('db down'));

    await expect(promoteUser('a@example.com', deps)).rejects.toThrow(
      'a@example.com is now an ADMIN, but the audit row could not be written: db down',
    );
    expect(sessions.deleteAllUserSessions).toHaveBeenCalledWith('u-1');
  });
});
