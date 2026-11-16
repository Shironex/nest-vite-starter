import type { PrismaService } from '../../common/database/prisma.service';
import { NotificationsRepository } from './notifications.repository';

const WIRE_SELECT = {
  id: true,
  type: true,
  title: true,
  message: true,
  readAt: true,
  createdAt: true,
};

const buildSubject = () => {
  const notification = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    updateMany: jest.fn(),
  };
  const prisma = { client: { notification } };
  const repo = new NotificationsRepository(prisma as unknown as PrismaService);
  return { repo, notification };
};

describe('NotificationsRepository', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-02T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('create persists the row and returns the wire projection', async () => {
    const { repo, notification } = buildSubject();
    notification.create.mockResolvedValue({ id: 'n-1' });

    const data = {
      userId: 'u-1',
      tenantId: 't-1',
      type: 'info',
      title: 't',
      message: 'm',
      jobId: 'job-1',
    };
    await repo.create(data);

    expect(notification.create).toHaveBeenCalledWith({ data, select: WIRE_SELECT });
  });

  it('findByJobId looks up by the unique jobId (worker retry dedupe)', async () => {
    const { repo, notification } = buildSubject();
    notification.findUnique.mockResolvedValue(null);

    await repo.findByJobId('job-1');

    expect(notification.findUnique).toHaveBeenCalledWith({
      where: { jobId: 'job-1' },
      select: WIRE_SELECT,
    });
  });

  it('listForUser reads newest-first with the wire projection, bounded by limit', async () => {
    const { repo, notification } = buildSubject();
    notification.findMany.mockResolvedValue([]);

    await repo.listForUser('u-1', 50);

    expect(notification.findMany).toHaveBeenCalledWith({
      where: { userId: 'u-1' },
      select: WIRE_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
  });

  it('countUnread counts { userId, readAt: null }', async () => {
    const { repo, notification } = buildSubject();
    notification.count.mockResolvedValue(3);

    await expect(repo.countUnread('u-1')).resolves.toBe(3);
    expect(notification.count).toHaveBeenCalledWith({
      where: { userId: 'u-1', readAt: null },
    });
  });

  it('markRead scopes the flip by { id, userId, readAt: null } (ownership + idempotence)', async () => {
    const { repo, notification } = buildSubject();
    notification.updateMany.mockResolvedValue({ count: 1 });

    await expect(repo.markRead('u-1', 'n-1')).resolves.toBe(1);
    expect(notification.updateMany).toHaveBeenCalledWith({
      where: { id: 'n-1', userId: 'u-1', readAt: null },
      data: { readAt: new Date('2026-07-02T12:00:00Z') },
    });
  });

  it('markAllRead flips every unread row for the caller only', async () => {
    const { repo, notification } = buildSubject();
    notification.updateMany.mockResolvedValue({ count: 4 });

    await expect(repo.markAllRead('u-1')).resolves.toBe(4);
    expect(notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u-1', readAt: null },
      data: { readAt: new Date('2026-07-02T12:00:00Z') },
    });
  });
});
