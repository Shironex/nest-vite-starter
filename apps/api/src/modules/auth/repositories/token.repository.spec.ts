import { Test } from '@nestjs/testing';
import { TokenRepository } from './token.repository';
import { PrismaService } from '../../../common/database/prisma.service';
import { buildPrismaMock, type PrismaServiceMock } from '@test/test-module';

const buildSubject = async () => {
  const prisma = buildPrismaMock();
  const module = await Test.createTestingModule({
    providers: [TokenRepository, { provide: PrismaService, useValue: prisma }],
  }).compile();
  return { repo: module.get(TokenRepository), prisma };
};

describe('TokenRepository', () => {
  it('create → client.token.create({ data })', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.token.create.mockResolvedValue({ id: 't-1' });
    const data = {
      userId: 'u-1',
      type: 'EMAIL_VERIFICATION' as const,
      token: 'h',
      expiresAt: new Date(),
    };
    await repo.create(data);
    expect(prisma.client.token.create).toHaveBeenCalledWith({ data });
  });

  it('create runs on the supplied transaction client when given', async () => {
    const { repo, prisma } = await buildSubject();
    const tx = { token: { create: jest.fn().mockResolvedValue({ id: 't-1' }) } };
    const data = {
      userId: 'u-1',
      type: 'PASSWORD_RESET' as const,
      token: 'h',
      expiresAt: new Date(),
    };
    await repo.create(data, tx as never);
    expect(tx.token.create).toHaveBeenCalledWith({ data });
    // The non-tx client must not be touched.
    expect(prisma.client.token.create).not.toHaveBeenCalled();
  });

  it('findByHashedToken → client.token.findFirst with type filter', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.token.findFirst.mockResolvedValue(null);
    await repo.findByHashedToken('hash', 'PASSWORD_RESET');
    expect(prisma.client.token.findFirst).toHaveBeenCalledWith({
      where: { token: 'hash', type: 'PASSWORD_RESET' },
    });
  });

  it('deleteById → client.token.delete', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.token.delete.mockResolvedValue({});
    await repo.deleteById('t-1');
    expect(prisma.client.token.delete).toHaveBeenCalledWith({ where: { id: 't-1' } });
  });

  it('deleteUserTokensByType → client.token.deleteMany', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.token.deleteMany.mockResolvedValue({ count: 0 });
    await repo.deleteUserTokensByType('u-1', 'EMAIL_VERIFICATION');
    expect(prisma.client.token.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u-1', type: 'EMAIL_VERIFICATION' },
    });
  });

  it('deleteUserTokensByType runs on the supplied transaction client when given', async () => {
    const { repo, prisma } = await buildSubject();
    const tx = { token: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    await repo.deleteUserTokensByType('u-1', 'PASSWORD_RESET', tx as never);
    expect(tx.token.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u-1', type: 'PASSWORD_RESET' },
    });
    // The non-tx client must not be touched.
    expect(prisma.client.token.deleteMany).not.toHaveBeenCalled();
  });

  describe('consumeById', () => {
    it('returns true when this call deleted the row', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.token.deleteMany.mockResolvedValue({ count: 1 });
      await expect(repo.consumeById('t-1')).resolves.toBe(true);
      expect(prisma.client.token.deleteMany).toHaveBeenCalledWith({ where: { id: 't-1' } });
    });

    it('returns false when a concurrent caller already consumed the row', async () => {
      const { repo, prisma } = await buildSubject();
      prisma.client.token.deleteMany.mockResolvedValue({ count: 0 });
      await expect(repo.consumeById('t-1')).resolves.toBe(false);
    });

    it('runs the delete on the supplied transaction client when given', async () => {
      const { repo, prisma } = await buildSubject();
      const tx = { token: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) } };
      await expect(repo.consumeById('t-1', tx as never)).resolves.toBe(true);
      expect(tx.token.deleteMany).toHaveBeenCalledWith({ where: { id: 't-1' } });
      // The non-tx client must not be touched.
      expect(prisma.client.token.deleteMany).not.toHaveBeenCalled();
    });
  });
});

// Reduce no-unused warning for unused PrismaServiceMock type alias.
type _ = PrismaServiceMock;
