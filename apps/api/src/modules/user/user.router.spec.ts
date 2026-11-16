import { UserRouter } from './user.router';

type Services = ConstructorParameters<typeof UserRouter>;

const buildRouter = () => {
  const userService = {
    getProfile: jest.fn().mockResolvedValue({ id: 'u-1', email: 'e' }),
    listUsers: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    updateRole: jest.fn().mockResolvedValue(undefined),
    adminDeleteUser: jest.fn().mockResolvedValue(undefined),
    disableUser: jest.fn().mockResolvedValue(undefined),
    enableUser: jest.fn().mockResolvedValue(undefined),
    revokeUserSessions: jest.fn().mockResolvedValue(undefined),
  };
  const lockoutService = {
    adminUnlock: jest.fn().mockResolvedValue(undefined),
  };
  const router = new UserRouter(
    userService as unknown as Services[0],
    lockoutService as unknown as Services[1],
  );
  return { router, userService, lockoutService };
};

const buildCtx = (userId = 'u-1') =>
  ({
    req: {} as unknown,
    res: {} as unknown,
    user: { id: userId, email: 'e', role: 'USER', emailVerified: true },
    session: null,
  }) as unknown as Parameters<UserRouter['me']>[0];

describe('UserRouter (wiring)', () => {
  it('me() delegates to userService.getProfile(user.id)', async () => {
    const { router, userService } = buildRouter();
    const result = await router.me(buildCtx('u-9'));
    expect(userService.getProfile).toHaveBeenCalledWith('u-9');
    expect(result).toEqual({ id: 'u-1', email: 'e' });
  });

  it('listUsers() forwards the zod-defaulted pagination input to userService.listUsers', async () => {
    const { router, userService } = buildRouter();
    await router.listUsers({ limit: 50 });
    expect(userService.listUsers).toHaveBeenCalledTimes(1);
    expect(userService.listUsers).toHaveBeenCalledWith({ limit: 50 });
  });

  it('listUsers() forwards an explicit cursor + limit', async () => {
    const { router, userService } = buildRouter();
    await router.listUsers({ cursor: 'u-50', limit: 25 });
    expect(userService.listUsers).toHaveBeenCalledWith({ cursor: 'u-50', limit: 25 });
  });

  it('unlockUser() delegates to lockoutService.adminUnlock', async () => {
    const { router, lockoutService } = buildRouter();
    const result = await router.unlockUser({ userId: 'target-1' });
    expect(lockoutService.adminUnlock).toHaveBeenCalledWith('target-1');
    expect(result).toEqual({ success: true });
  });

  it('updateUserRole() delegates target + caller id to userService.updateRole', async () => {
    const { router, userService } = buildRouter();
    const result = await router.updateUserRole(
      { userId: 'target-1', role: 'ADMIN' },
      buildCtx('admin-1') as unknown as Parameters<UserRouter['updateUserRole']>[1],
    );
    // The caller's id comes from the session, never from the input: a
    // self-target rule an attacker can spoof is not a rule.
    expect(userService.updateRole).toHaveBeenCalledWith('admin-1', 'target-1', 'ADMIN');
    expect(result).toEqual({ success: true });
  });

  it('adminDeleteUser() delegates target + caller id to userService.adminDeleteUser', async () => {
    const { router, userService } = buildRouter();
    const result = await router.adminDeleteUser(
      buildCtx('admin-1') as unknown as Parameters<UserRouter['adminDeleteUser']>[0],
      { userId: 'target-1' },
    );
    expect(userService.adminDeleteUser).toHaveBeenCalledWith('target-1', 'admin-1');
    expect(result).toEqual({ deleted: true });
  });

  it('disableUser() delegates target + caller id to userService.disableUser', async () => {
    const { router, userService } = buildRouter();

    const result = await router.disableUser(
      { userId: 'target-1' },
      buildCtx('admin-1') as unknown as Parameters<UserRouter['disableUser']>[1],
    );

    // The caller's id comes from the session, never from the input: the
    // no-self-disable rule would be spoofable otherwise.
    expect(userService.disableUser).toHaveBeenCalledWith('admin-1', 'target-1');
    expect(result).toEqual({ success: true });
  });

  it('enableUser() delegates the target to userService.enableUser', async () => {
    const { router, userService } = buildRouter();

    const result = await router.enableUser({ userId: 'target-1' });

    expect(userService.enableUser).toHaveBeenCalledWith('target-1');
    expect(result).toEqual({ success: true });
  });

  it('revokeUserSessions() delegates target + caller id to userService.revokeUserSessions', async () => {
    const { router, userService } = buildRouter();

    const result = await router.revokeUserSessions(
      { userId: 'target-1' },
      buildCtx('admin-1') as unknown as Parameters<UserRouter['revokeUserSessions']>[1],
    );

    expect(userService.revokeUserSessions).toHaveBeenCalledWith('admin-1', 'target-1');
    expect(result).toEqual({ success: true });
  });
});
