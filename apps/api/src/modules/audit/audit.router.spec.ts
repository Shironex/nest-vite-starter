import { AuditRouter } from './audit.router';
import type { AuditReadService } from './audit-read.service';

const buildRouter = () => {
  const auditReadService = {
    list: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
  };
  const router = new AuditRouter(auditReadService as unknown as AuditReadService);
  return { router, auditReadService };
};

describe('AuditRouter (wiring)', () => {
  it('list() delegates the parsed input to the read service', async () => {
    const { router, auditReadService } = buildRouter();
    const input = { limit: 25, actorId: 'u-1' };
    const result = await router.list(input);
    expect(auditReadService.list).toHaveBeenCalledWith(input);
    expect(result).toEqual({ items: [], nextCursor: null });
  });
});
