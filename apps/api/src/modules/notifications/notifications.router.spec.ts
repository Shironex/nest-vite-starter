import { NotificationsRouter } from './notifications.router';

type Services = ConstructorParameters<typeof NotificationsRouter>;

const buildRouter = () => {
  const notificationsService = {
    listForUser: jest.fn().mockResolvedValue({ items: [], unreadCount: 0 }),
    markRead: jest.fn().mockResolvedValue({ updated: true }),
    markAllRead: jest.fn().mockResolvedValue({ updated: 2 }),
  };
  const notificationPreferencesService = {
    getForUser: jest.fn().mockResolvedValue({ channels: {}, isDefault: true, updatedAt: null }),
    updateForUser: jest.fn().mockResolvedValue({ channels: {}, isDefault: false, updatedAt: null }),
  };
  const router = new NotificationsRouter(
    notificationsService as unknown as Services[0],
    notificationPreferencesService as unknown as Services[1],
  );
  return { router, notificationsService, notificationPreferencesService };
};

const buildCtx = (userId = 'u-1') =>
  ({
    req: {} as unknown,
    res: {} as unknown,
    user: { id: userId, email: 'e', role: 'USER', emailVerified: true },
    session: { id: 's-1', token: 'tok' },
  }) as unknown as Parameters<NotificationsRouter['list']>[0];

describe('NotificationsRouter (wiring)', () => {
  it('list() delegates to listForUser(user.id, limit) and returns the page', async () => {
    const { router, notificationsService } = buildRouter();
    const result = await router.list(buildCtx('u-9'), { limit: 25 });
    expect(notificationsService.listForUser).toHaveBeenCalledWith('u-9', 25);
    expect(result).toEqual({ items: [], unreadCount: 0 });
  });

  it('markRead() scopes by the CALLER id from ctx, never from input', async () => {
    const { router, notificationsService } = buildRouter();
    const result = await router.markRead(buildCtx('u-2'), { id: 'n-7' });
    expect(notificationsService.markRead).toHaveBeenCalledWith('u-2', 'n-7');
    expect(result).toEqual({ updated: true });
  });

  it('markAllRead() delegates with the caller id', async () => {
    const { router, notificationsService } = buildRouter();
    const result = await router.markAllRead(buildCtx('u-3'));
    expect(notificationsService.markAllRead).toHaveBeenCalledWith('u-3');
    expect(result).toEqual({ updated: 2 });
  });

  it('preferencesGet() delegates with the caller id', async () => {
    const { router, notificationPreferencesService } = buildRouter();
    await router.preferencesGet(buildCtx('u-4'));
    expect(notificationPreferencesService.getForUser).toHaveBeenCalledWith('u-4');
  });

  it('preferencesUpdate() scopes by the CALLER id from ctx, never from input', async () => {
    const { router, notificationPreferencesService } = buildRouter();
    const channels = { WORKSPACE_CREATED: { inApp: true, digest: true } };
    await router.preferencesUpdate(buildCtx('u-5'), { channels } as unknown as Parameters<
      NotificationsRouter['preferencesUpdate']
    >[1]);
    expect(notificationPreferencesService.updateForUser).toHaveBeenCalledWith('u-5', channels);
  });
});
