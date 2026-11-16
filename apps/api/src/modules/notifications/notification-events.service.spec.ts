import { NOTIFICATION_CATEGORIES } from '@repo/shared/schemas';
import { requestContext } from '../../common/context/request-context';
import { NotificationEventsService } from './notification-events.service';

type Deps = ConstructorParameters<typeof NotificationEventsService>;

const TENANT = 'tenant-a';
const ACTOR = 'actor-1';

/** Run `fn` the way a request handler would: tenant + actor in the ALS. */
const asActor = <T>(fn: () => Promise<T>): Promise<T> =>
  requestContext.run({ requestId: 'spec', tenantId: TENANT, userId: ACTOR }, fn);

const buildSubject = () => {
  const repository = {
    listActiveUsersByTenant: jest.fn().mockResolvedValue([
      { id: ACTOR, role: 'ADMIN' },
      { id: 'admin-2', role: 'ADMIN' },
      { id: 'user-3', role: 'USER' },
    ]),
  };
  const notifications = {
    notify: jest.fn().mockResolvedValue(undefined),
    notifyMany: jest.fn().mockResolvedValue(undefined),
  };
  // Default: everyone passes the preference gate; individual tests narrow it.
  const preferences = {
    filterByChannel: jest.fn((userIds: readonly string[]): Promise<string[]> =>
      Promise.resolve([...userIds]),
    ),
  };
  const service = new NotificationEventsService(
    repository as unknown as Deps[0],
    notifications as unknown as Deps[1],
    preferences as unknown as Deps[2],
  );
  return { service, repository, notifications, preferences };
};

describe('NotificationEventsService', () => {
  describe('audience & preference gating', () => {
    it('workspaceCreated broadcasts to the whole staff except the actor', async () => {
      const { service, notifications, preferences } = buildSubject();

      await asActor(() => service.workspaceCreated('Northwind'));

      // The actor never hears about their own click; everyone else is offered
      // to the preference gate.
      expect(preferences.filterByChannel).toHaveBeenCalledWith(
        ['admin-2', 'user-3'],
        NOTIFICATION_CATEGORIES.WORKSPACE_CREATED,
        'inApp',
      );
      // ONE enqueue for the whole audience: this runs inside the awaited
      // mutation, so a per-recipient loop billed the creating user for every
      // colleague's courtesy notification.
      expect(notifications.notifyMany).toHaveBeenCalledTimes(1);
      expect(notifications.notifyMany).toHaveBeenCalledWith(
        ['admin-2', 'user-3'],
        expect.objectContaining({ title: 'New workspace: Northwind' }),
      );
    });

    it('delivers only to users whose preference keeps the category on', async () => {
      const { service, notifications, preferences } = buildSubject();
      // The real filterByChannel drops everyone by default (events are
      // muted-by-default); here only one user has opted in.
      preferences.filterByChannel.mockResolvedValue(['user-3']);

      await asActor(() => service.workspaceCreated('Northwind'));

      expect(notifications.notifyMany).toHaveBeenCalledWith(
        ['user-3'],
        expect.objectContaining({ title: 'New workspace: Northwind' }),
      );
    });

    it('delivers nothing when the gate returns nobody (the default for new events)', async () => {
      const { service, notifications, preferences } = buildSubject();
      preferences.filterByChannel.mockResolvedValue([]);

      await asActor(() => service.workspaceCreated('Northwind'));

      expect(notifications.notifyMany).toHaveBeenCalledWith([], expect.anything());
    });

    it('admin actions go to the OTHER admins only', async () => {
      const { service, preferences } = buildSubject();

      await asActor(() =>
        service.adminRoleChanged({ targetEmail: 'x@example.com', role: 'ADMIN' }),
      );

      expect(preferences.filterByChannel).toHaveBeenCalledWith(
        ['admin-2'],
        NOTIFICATION_CATEGORIES.ADMIN_ACTIONS,
        'inApp',
      );
    });

    it('is a silent no-op outside a tenant context (seeds, system jobs)', async () => {
      const { service, repository, notifications } = buildSubject();

      await service.workspaceCreated('Northwind');

      expect(repository.listActiveUsersByTenant).not.toHaveBeenCalled();
      expect(notifications.notifyMany).not.toHaveBeenCalled();
    });
  });

  describe('fail-soft contract', () => {
    it('swallows a recipient-read failure instead of failing the business write', async () => {
      const { service, repository } = buildSubject();
      repository.listActiveUsersByTenant.mockRejectedValue(new Error('db down'));

      await expect(asActor(() => service.workspaceCreated('Northwind'))).resolves.toBeUndefined();
    });

    it('swallows an enqueue failure instead of failing the business write', async () => {
      const { service, notifications } = buildSubject();
      notifications.notifyMany.mockRejectedValue(new Error('redis down'));

      await expect(
        asActor(() => service.adminUserDeleted({ targetEmail: 'x@example.com' })),
      ).resolves.toBeUndefined();
    });
  });

  describe('copy', () => {
    it('adminRoleChanged names the target and the role label', async () => {
      const { service, notifications } = buildSubject();

      await asActor(() => service.adminRoleChanged({ targetEmail: 'x@example.com', role: 'USER' }));

      expect(notifications.notifyMany).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          title: 'User role changed',
          message: 'x@example.com: new role User.',
        }),
      );
    });

    it('adminUserDeleted is a warning naming the removed account', async () => {
      const { service, notifications } = buildSubject();

      await asActor(() => service.adminUserDeleted({ targetEmail: 'x@example.com' }));

      expect(notifications.notifyMany).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          type: 'warning',
          message: 'An administrator deleted the account x@example.com.',
        }),
      );
    });
  });
});
