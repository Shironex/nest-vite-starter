import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { buildPrismaMock } from '@test/test-module';
import { PrismaService } from '../../common/database/prisma.service';
import { AvatarOwnerPort } from '../storage/avatar-owner.port';
import { AvatarOwnerModule } from './avatar-owner.module';
import { UserRepository } from './user.repository';

// Stands in for the @Global PrismaModule the leaf relies on in the real app.
const prisma = buildPrismaMock();
@Global()
@Module({
  providers: [{ provide: PrismaService, useValue: prisma }],
  exports: [PrismaService],
})
class GlobalPrismaStub {}

describe('AvatarOwnerModule', () => {
  it('resolves AvatarOwnerPort to the user repository with no other import', async () => {
    const module = await Test.createTestingModule({
      imports: [GlobalPrismaStub, AvatarOwnerModule],
    }).compile();

    expect(module.get(AvatarOwnerPort)).toBeInstanceOf(UserRepository);
  });

  it('exports the port and nothing else, so storage cannot reach user queries', () => {
    const exported: unknown = Reflect.getMetadata('exports', AvatarOwnerModule);
    const imported: unknown = Reflect.getMetadata('imports', AvatarOwnerModule);

    expect(exported).toEqual([AvatarOwnerPort]);
    // A leaf: importing anything would put the UserModule cycle back in reach.
    expect(imported ?? []).toEqual([]);
  });

  it('clears through the compare-and-swap, not an unconditional write', async () => {
    const module = await Test.createTestingModule({
      imports: [GlobalPrismaStub, AvatarOwnerModule],
    }).compile();
    prisma.client.user.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      module.get(AvatarOwnerPort).clearAvatarIfCurrent('u-1', 'avatars/u-1/old.png'),
    ).resolves.toBe(false);
    expect(prisma.client.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u-1', avatarUrl: 'avatars/u-1/old.png', deletedAt: null },
      data: { avatarUrl: null },
    });
  });
});
