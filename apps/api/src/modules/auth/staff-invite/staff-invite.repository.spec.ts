import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../common/database/prisma.service';
import { StaffInviteRepository } from './staff-invite.repository';
import { buildPrismaMock } from '@test/test-module';

const buildSubject = async () => {
  const prisma = buildPrismaMock();
  const module = await Test.createTestingModule({
    providers: [StaffInviteRepository, { provide: PrismaService, useValue: prisma }],
  }).compile();
  return { repo: module.get(StaffInviteRepository), prisma };
};

describe('StaffInviteRepository', () => {
  it('findDisplayName reads only a live row, so a soft-deleted inviter yields null', async () => {
    const { repo, prisma } = await buildSubject();
    prisma.client.user.findFirst.mockResolvedValue(null);

    await expect(repo.findDisplayName('u-removed')).resolves.toBeNull();
    expect(prisma.client.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'u-removed', deletedAt: null },
      select: { displayName: true },
    });
  });
});
