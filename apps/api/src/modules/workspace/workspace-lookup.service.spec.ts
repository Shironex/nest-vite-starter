import { AppErrorCode } from '@repo/shared/errors';
import type { PrismaService } from '../../common/database/prisma.service';
import { buildPrismaHrTx, buildPrismaMock } from '@test/test-module';
import { expectRejectsDomainError } from '@test/domain-error-matchers';
import { NotFoundError } from '../../common/errors/domain-error';
import { WorkspaceRepository } from './workspace.repository';
import { WorkspaceLookupService } from './workspace-lookup.service';

const buildSubject = () => {
  const prisma = buildPrismaMock();
  const service = new WorkspaceLookupService(
    new WorkspaceRepository(prisma as unknown as PrismaService),
  );
  return { service, prisma };
};

describe('WorkspaceLookupService', () => {
  describe('assertInTenant', () => {
    it('passes a Workspace the tenant-scoped read can see', async () => {
      const { service, prisma } = buildSubject();
      prisma.client.workspace.findUnique.mockResolvedValue({ id: 'f-1' });

      await expect(service.assertInTenant('f-1')).resolves.toBeUndefined();
      expect(prisma.client.workspace.findUnique).toHaveBeenCalledWith({
        where: { id: 'f-1' },
        select: { id: true },
      });
    });

    // A Workspace of another organization resolves to null under the scope, so it must be
    // refused with the SAME error as a missing one: a FORBIDDEN would confirm
    // the id exists in some other tenant.
    it('refuses an id the scoped read cannot see with NOT_FOUND', async () => {
      const { service, prisma } = buildSubject();
      prisma.client.workspace.findUnique.mockResolvedValue(null);

      await expectRejectsDomainError(service.assertInTenant('f-foreign'), {
        type: NotFoundError,
        appCode: AppErrorCode.NOT_FOUND,
        message: 'Workspace not found in this tenant.',
      });
    });

    // Domain services call this inside their own write transactions. A read
    // on the outer client there would take a second pool connection while the
    // transaction holds its row locks.
    it('reads through the transaction client when one is passed', async () => {
      const { service, prisma } = buildSubject();
      const tx = buildPrismaHrTx();
      tx.workspace.findUnique.mockResolvedValue({ id: 'f-1' });

      await service.assertInTenant('f-1', tx as never);

      expect(tx.workspace.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.client.workspace.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('returns every Workspace the scope sees, name-ascending', async () => {
      const { service, prisma } = buildSubject();
      const rows = [{ id: 'f-1', name: 'Northwind' }];
      prisma.client.workspace.findMany.mockResolvedValue(rows);

      await expect(service.list()).resolves.toBe(rows);
      expect(prisma.client.workspace.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { name: 'asc' } }),
      );
    });
  });
});
