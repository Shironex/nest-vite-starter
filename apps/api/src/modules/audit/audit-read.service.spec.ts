import { AuditReadService } from './audit-read.service';
import type { AuditReadRepository } from './audit-read.repository';
import { requestContext } from '../../common/context/request-context';
import { ForbiddenError } from '../../common/errors';

const buildSubject = () => {
  const repository = {
    listPage: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
  };
  const service = new AuditReadService(repository as unknown as AuditReadRepository);
  return { service, repository };
};

const run = <T>(tenantId: string | undefined, fn: () => Promise<T>): Promise<T> =>
  requestContext.run({ requestId: 'audit-read-spec', tenantId }, fn);

describe('AuditReadService', () => {
  it('resolves the tenant from the ALS and hands it to the repository explicitly', async () => {
    const { service, repository } = buildSubject();
    await run('tenant-a', async () => {
      await service.list({ limit: 25, actorId: 'u-1' });
    });
    expect(repository.listPage).toHaveBeenCalledWith('tenant-a', { limit: 25, actorId: 'u-1' });
  });

  it('fails closed outside a tenant context instead of listing every organization', async () => {
    const { service, repository } = buildSubject();
    // Called OUTSIDE requestContext.run: no active tenant -> Forbidden.
    await expect(service.list({ limit: 25 })).rejects.toBeInstanceOf(ForbiddenError);
    expect(repository.listPage).not.toHaveBeenCalled();
  });

  it('fails closed when the context carries no tenant (pre-auth caller)', async () => {
    const { service, repository } = buildSubject();
    await run(undefined, async () => {
      await expect(service.list({ limit: 25 })).rejects.toBeInstanceOf(ForbiddenError);
    });
    expect(repository.listPage).not.toHaveBeenCalled();
  });
});
