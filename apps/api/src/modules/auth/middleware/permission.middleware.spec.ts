import { Test } from '@nestjs/testing';
import { ManageUsersMiddleware } from './permission.middleware';
import { PrismaService } from '../../../common/database/prisma.service';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { buildPrismaMock, buildRedisMock } from '@test/test-module';

const buildSubject = async () => {
  const prisma = buildPrismaMock();
  const redis = buildRedisMock();
  const module = await Test.createTestingModule({
    providers: [
      ManageUsersMiddleware,
      { provide: PrismaService, useValue: prisma },
      { provide: REDIS_CLIENT, useValue: redis },
    ],
  }).compile();
  return { service: module.get(ManageUsersMiddleware), prisma, redis };
};

const buildOpts = (user: { id: string; role: string } | null) => {
  const next = jest.fn().mockResolvedValue('ok');
  const opts: Parameters<ManageUsersMiddleware['use']>[0] = {
    ctx: { user, req: {}, res: {}, session: null },
    type: 'query',
    path: 'user.list',
    input: undefined,
    getRawInput: async () => undefined,
    meta: undefined,
    signal: undefined,
    next,
  };
  return { next, opts };
};

describe('PermissionMiddleware (ManageUsersMiddleware)', () => {
  it('throws UNAUTHORIZED when ctx.user is missing', async () => {
    const { service } = await buildSubject();
    const { opts } = buildOpts(null);
    await expect(service.use(opts)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Not authenticated',
    });
  });

  it('cache hit: returns parsed permissions, calls next(), does NOT query Prisma', async () => {
    const { service, prisma, redis } = await buildSubject();
    redis.get.mockResolvedValue(JSON.stringify(['manage_users']));
    const { opts, next } = buildOpts({ id: 'u-1', role: 'ADMIN' });

    await service.use(opts);

    expect(next).toHaveBeenCalled();
    expect(prisma.client.rolePermission.findMany).not.toHaveBeenCalled();
  });

  it('cache miss: queries Prisma with OR(role,userId), caches result with 300s TTL', async () => {
    const { service, prisma, redis } = await buildSubject();
    redis.get.mockResolvedValue(null);
    prisma.client.rolePermission.findMany.mockResolvedValue([
      { permission: { name: 'manage_users' } },
      { permission: { name: 'manage_users' } }, // de-duped
      { permission: { name: 'view_audit_log' } },
    ]);
    const { opts, next } = buildOpts({ id: 'u-1', role: 'ADMIN' });

    await service.use(opts);

    expect(prisma.client.rolePermission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ role: 'ADMIN', userId: null }, { userId: 'u-1' }] },
      }),
    );
    expect(redis.setex).toHaveBeenCalledWith(
      expect.stringContaining('permissions:u-1'),
      300,
      JSON.stringify(['manage_users', 'view_audit_log']),
    );
    expect(next).toHaveBeenCalled();
  });

  it('throws FORBIDDEN with "Missing permission" when required perm is absent', async () => {
    const { service, redis } = await buildSubject();
    redis.get.mockResolvedValue(JSON.stringify(['view_audit_log']));
    const { opts } = buildOpts({ id: 'u-1', role: 'USER' });

    await expect(service.use(opts)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: expect.stringContaining('Missing permission: manage_users'),
    });
  });

  it('de-dupes overlapping role + user-override permissions via Set', async () => {
    const { service, prisma, redis } = await buildSubject();
    redis.get.mockResolvedValue(null);
    prisma.client.rolePermission.findMany.mockResolvedValue([
      { permission: { name: 'manage_users' } },
      { permission: { name: 'manage_users' } },
      { permission: { name: 'manage_users' } },
    ]);
    const { opts } = buildOpts({ id: 'u-1', role: 'ADMIN' });

    await service.use(opts);

    const cached = JSON.parse(redis.setex.mock.calls[0][2] as string);
    expect(cached).toEqual(['manage_users']);
  });
});
