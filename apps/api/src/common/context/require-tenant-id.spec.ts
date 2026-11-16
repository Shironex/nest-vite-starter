import { requestContext } from './request-context';
import { requireTenantId } from './require-tenant-id';
import { AppErrorCode } from '@repo/shared/errors';
import { expectThrowsDomainError } from '@test/domain-error-matchers';
import { UnauthorizedError } from '../errors/domain-error';

describe('requireTenantId', () => {
  it('returns the ALS tenant inside a request scope', () => {
    requestContext.run({ requestId: 'spec', tenantId: 't-1' }, () => {
      expect(requireTenantId()).toBe('t-1');
    });
  });

  it('fails closed outside a tenant scope, like the Prisma extension', () => {
    expectThrowsDomainError(() => requireTenantId(), {
      type: UnauthorizedError,
      appCode: AppErrorCode.UNAUTHORIZED,
      message: 'Tenant context required.',
    });
  });
});
