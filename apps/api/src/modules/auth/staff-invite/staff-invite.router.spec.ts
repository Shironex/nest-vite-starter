import { ROLES } from '@repo/shared/permissions';
import { StaffInviteRouter } from './staff-invite.router';
import { StaffInviteService } from './staff-invite.service';

const buildRouter = () => {
  const staffInviteService = {
    invite: jest.fn().mockResolvedValue({ pending: true, emailSent: true }),
    revoke: jest.fn().mockResolvedValue(undefined),
    withdrawByEmail: jest.fn().mockResolvedValue(undefined),
  };
  const router = new StaffInviteRouter(staffInviteService as unknown as StaffInviteService);
  return { router, staffInviteService };
};

const buildCtx = (userId = 'admin-1') =>
  ({
    req: { headers: {}, socket: {} },
    res: {},
    user: { id: userId, email: 'e', role: ROLES.ADMIN, emailVerified: true },
    session: { id: 's-1', token: 't' },
  }) as unknown as Parameters<StaffInviteRouter['send']>[1];

describe('StaffInviteRouter (wiring)', () => {
  it('takes the inviter from the session, never from the input', async () => {
    // An invitation attributes an access grant to somebody. An actor id an
    // attacker can supply is not an attribution.
    const { router, staffInviteService } = buildRouter();

    await router.send({ email: 'new@example.com', role: ROLES.USER }, buildCtx('admin-9'));

    expect(staffInviteService.invite).toHaveBeenCalledWith(
      'new@example.com',
      ROLES.USER,
      'admin-9',
      expect.any(String),
      expect.any(String),
    );
  });

  it('passes no tenant, because the service reads the active one from the ALS', async () => {
    // Deliberate: a router that COULD pass a tenant would eventually pass the
    // wrong one, and this procedure grants an organization's entire tenant-scoped read
    // surface to somebody new.
    const { router, staffInviteService } = buildRouter();

    await router.send({ email: 'new@example.com', role: ROLES.ADMIN }, buildCtx());

    expect(staffInviteService.invite.mock.calls[0]).toHaveLength(5);
  });

  it('revoke() delegates the pending user id and acks', async () => {
    const { router, staffInviteService } = buildRouter();

    const result = await router.revoke(
      { userId: 'pending-1' },
      buildCtx() as unknown as Parameters<StaffInviteRouter['revoke']>[1],
    );

    expect(staffInviteService.revoke).toHaveBeenCalledWith(
      'pending-1',
      'admin-1',
      expect.any(String),
      expect.any(String),
    );
    expect(result).toEqual({ success: true });
  });

  it('revoke() takes the actor from the session, so the self refusal cannot be dodged', async () => {
    const { router, staffInviteService } = buildRouter();

    await router.revoke(
      { userId: 'pending-1' },
      buildCtx('admin-9') as unknown as Parameters<StaffInviteRouter['revoke']>[1],
    );

    expect(staffInviteService.revoke.mock.calls[0]![1]).toBe('admin-9');
  });

  it('withdrawByEmail() delegates the address and acks, whatever the service found', async () => {
    const { router, staffInviteService } = buildRouter();

    const result = await router.withdrawByEmail(
      { email: 'own@example.com' },
      buildCtx() as unknown as Parameters<StaffInviteRouter['withdrawByEmail']>[1],
    );

    expect(staffInviteService.withdrawByEmail).toHaveBeenCalledWith(
      'own@example.com',
      expect.any(String),
      expect.any(String),
    );
    expect(result).toEqual({ success: true });
  });
});
