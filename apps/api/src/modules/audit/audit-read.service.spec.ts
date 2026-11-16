import { AuditReadService } from './audit-read.service';
import type { AuditReadRepository } from './audit-read.repository';

const buildSubject = () => {
  const repository = {
    listPage: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
  };
  const service = new AuditReadService(repository as unknown as AuditReadRepository);
  return { service, repository };
};

describe('AuditReadService', () => {
  it('hands the filters to the repository unchanged', async () => {
    const { service, repository } = buildSubject();
    await service.list({ limit: 25, actorId: 'u-1' });
    expect(repository.listPage).toHaveBeenCalledWith({ limit: 25, actorId: 'u-1' });
  });
});
