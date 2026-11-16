import { requestContext } from '../../common/context/request-context';
import { NotificationsService } from './notifications.service';
import { NOTIFICATION_DISPATCH_JOB_NAMES } from './notification-dispatch/notification-dispatch.constants';

type Deps = ConstructorParameters<typeof NotificationsService>;

const buildSubject = () => {
  const queue = {
    add: jest.fn().mockResolvedValue(undefined),
    addBulk: jest.fn().mockResolvedValue([]),
  };
  const repository = {
    listForUser: jest.fn().mockResolvedValue([]),
    countUnread: jest.fn().mockResolvedValue(0),
    markRead: jest.fn().mockResolvedValue(0),
    markAllRead: jest.fn().mockResolvedValue(0),
  };
  const service = new NotificationsService(
    queue as unknown as Deps[0],
    repository as unknown as Deps[1],
  );
  return { service, queue, repository };
};

describe('NotificationsService', () => {
  describe('notify', () => {
    it('enqueues a DISPATCH job carrying userId + notification (withJobContext-wrapped)', async () => {
      const { service, queue } = buildSubject();

      await service.notify('u-1', { type: 'success', title: 'Done', message: 'Export ready' });

      expect(queue.add).toHaveBeenCalledWith(
        NOTIFICATION_DISPATCH_JOB_NAMES.DISPATCH,
        expect.objectContaining({
          userId: 'u-1',
          notification: { type: 'success', title: 'Done', message: 'Export ready' },
        }),
        // Producer-minted UUID jobId: survives a Redis counter reset, unlike
        // BullMQ's auto-increment id (see notify()'s doc comment).
        { jobId: expect.stringMatching(/^[0-9a-f-]{36}$/) },
      );
    });

    it('propagates an enqueue failure to the caller', async () => {
      const { service, queue } = buildSubject();
      queue.add.mockRejectedValue(new Error('redis down'));

      await expect(
        service.notify('u-1', { type: 'info', title: 't', message: 'm' }),
      ).rejects.toThrow('redis down');
    });
  });

  describe('sendTestNotification', () => {
    it('rides the same notify pipeline with an info payload addressing the user', async () => {
      const { service, queue } = buildSubject();

      await service.sendTestNotification({ id: 'u-1', email: 'jane@example.com' });

      expect(queue.add).toHaveBeenCalledWith(
        NOTIFICATION_DISPATCH_JOB_NAMES.DISPATCH,
        expect.objectContaining({
          userId: 'u-1',
          notification: expect.objectContaining({
            type: 'info',
            title: 'Test Notification',
            message: expect.stringContaining('jane@example.com'),
          }),
        }),
        { jobId: expect.stringMatching(/^[0-9a-f-]{36}$/) },
      );
    });
  });

  describe('listForUser', () => {
    it('maps rows to the wire shape: read derived from readAt, createdAt as ISO string', async () => {
      const { service, repository } = buildSubject();
      repository.listForUser.mockResolvedValue([
        {
          id: 'n-1',
          type: 'info',
          title: 't1',
          message: 'm1',
          readAt: null,
          createdAt: new Date('2026-07-02T10:00:00Z'),
        },
        {
          id: 'n-2',
          type: 'error',
          title: 't2',
          message: 'm2',
          readAt: new Date('2026-07-02T11:00:00Z'),
          createdAt: new Date('2026-07-01T10:00:00Z'),
        },
      ]);
      repository.countUnread.mockResolvedValue(7);

      const result = await service.listForUser('u-1', 50);

      expect(repository.listForUser).toHaveBeenCalledWith('u-1', 50);
      expect(repository.countUnread).toHaveBeenCalledWith('u-1');
      expect(result).toEqual({
        items: [
          {
            id: 'n-1',
            type: 'info',
            title: 't1',
            message: 'm1',
            read: false,
            createdAt: '2026-07-02T10:00:00.000Z',
          },
          {
            id: 'n-2',
            type: 'error',
            title: 't2',
            message: 'm2',
            read: true,
            createdAt: '2026-07-01T10:00:00.000Z',
          },
        ],
        unreadCount: 7,
      });
    });

    /**
     * The `type` column is TEXT and the router's output schema is
     * runtime-validated, so one off-enum row used to fail the WHOLE list with a
     * 500 and empty somebody's bell. `info` is the neutral fallback: dropping
     * the row would lose a notification the user was sent, and `error` would
     * invent an alarm.
     */
    it('shows a row with an unknown type as info instead of failing the whole list', async () => {
      const { service, repository } = buildSubject();
      repository.listForUser.mockResolvedValue([
        {
          id: 'n-1',
          type: 'reminder',
          title: 't1',
          message: 'm1',
          readAt: null,
          createdAt: new Date('2026-07-02T10:00:00Z'),
        },
        {
          id: 'n-2',
          type: 'warning',
          title: 't2',
          message: 'm2',
          readAt: null,
          createdAt: new Date('2026-07-02T10:00:00Z'),
        },
      ]);
      repository.countUnread.mockResolvedValue(2);

      const result = await service.listForUser('u-1', 50);

      expect(result.items.map((item) => item.type)).toEqual(['info', 'warning']);
    });
  });

  describe('markRead', () => {
    it('returns updated: true when a row flipped', async () => {
      const { service, repository } = buildSubject();
      repository.markRead.mockResolvedValue(1);

      await expect(service.markRead('u-1', 'n-1')).resolves.toEqual({ updated: true });
      expect(repository.markRead).toHaveBeenCalledWith('u-1', 'n-1');
    });

    it("returns updated: false when nothing matched (already read, or not the caller's row)", async () => {
      const { service, repository } = buildSubject();
      repository.markRead.mockResolvedValue(0);

      await expect(service.markRead('u-1', 'n-x')).resolves.toEqual({ updated: false });
    });
  });

  describe('markAllRead', () => {
    it('returns how many rows flipped', async () => {
      const { service, repository } = buildSubject();
      repository.markAllRead.mockResolvedValue(4);

      await expect(service.markAllRead('u-1')).resolves.toEqual({ updated: 4 });
      expect(repository.markAllRead).toHaveBeenCalledWith('u-1');
    });
  });

  describe('notifyMany', () => {
    it('enqueues one job per recipient in a single addBulk, each with its own jobId', async () => {
      const { service, queue } = buildSubject();

      await service.notifyMany(['u-1', 'u-2'], { type: 'warning', title: 't', message: 'm' });

      // One round trip, not one per recipient, and no `add` fallback.
      expect(queue.add).not.toHaveBeenCalled();
      expect(queue.addBulk).toHaveBeenCalledTimes(1);

      const jobs = queue.addBulk.mock.calls[0]?.[0] as Array<{
        name: string;
        data: { userId: string; notification: unknown };
        opts: { jobId: string };
      }>;
      expect(jobs.map((job) => job.name)).toEqual([
        NOTIFICATION_DISPATCH_JOB_NAMES.DISPATCH,
        NOTIFICATION_DISPATCH_JOB_NAMES.DISPATCH,
      ]);
      expect(jobs.map((job) => job.data.userId)).toEqual(['u-1', 'u-2']);
      // Producer-minted and DISTINCT: a shared jobId would make BullMQ treat
      // the second recipient's notification as a retry of the first and drop
      // it, which is a silently missing notification rather than an error.
      for (const job of jobs) {
        expect(job.opts.jobId).toMatch(/^[0-9a-f-]{36}$/);
      }
      expect(new Set(jobs.map((job) => job.opts.jobId)).size).toBe(2);
    });

    it('captures the job-context envelope once, from the producing request', async () => {
      const { service, queue } = buildSubject();

      await requestContext.run({ requestId: 'req-1', tenantId: 'tenant-a' }, () =>
        service.notifyMany(['u-1', 'u-2'], { type: 'info', title: 't', message: 'm' }),
      );

      const jobs = queue.addBulk.mock.calls[0]?.[0] as Array<{
        data: { _ctx?: { requestId?: string; tenantId?: string } };
      }>;
      // Every job carries the envelope an individual `notify` would have put on
      // it, so the worker still rebuilds the producing request's context.
      for (const job of jobs) {
        expect(job.data._ctx).toMatchObject({ requestId: 'req-1', tenantId: 'tenant-a' });
      }
    });

    it('touches the queue at all only when there is an audience', async () => {
      const { service, queue } = buildSubject();

      await service.notifyMany([], { type: 'info', title: 't', message: 'm' });

      expect(queue.addBulk).not.toHaveBeenCalled();
    });

    it('propagates a bulk enqueue failure, so a claiming caller can release', async () => {
      const { service, queue } = buildSubject();
      queue.addBulk.mockRejectedValue(new Error('redis down'));

      await expect(
        service.notifyMany(['u-1'], { type: 'info', title: 't', message: 'm' }),
      ).rejects.toThrow('redis down');
    });
  });
});
