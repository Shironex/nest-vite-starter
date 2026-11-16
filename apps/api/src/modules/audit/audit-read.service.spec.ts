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
  it('hands the page request to the repository unchanged', async () => {
    const { service, repository } = buildSubject();
    await service.list({ limit: 25, cursor: 'a-25' });
    expect(repository.listPage).toHaveBeenCalledWith({ limit: 25, cursor: 'a-25' });
  });
});
