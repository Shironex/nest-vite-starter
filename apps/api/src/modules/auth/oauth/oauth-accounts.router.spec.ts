import { AppErrorCode } from '@repo/shared/errors';
import { expressMocks } from '@test/fixtures';
import { OAuthAccountsRouter } from './oauth-accounts.router';

type Deps = ConstructorParameters<typeof OAuthAccountsRouter>;

const buildRouter = () => {
  const accountService = {
    listAccounts: jest.fn().mockResolvedValue([]),
    unlink: jest.fn().mockResolvedValue(undefined),
  };
  const sudoService = {
    isActive: jest.fn().mockResolvedValue(true),
  };
  const router = new OAuthAccountsRouter(
    accountService as unknown as Deps[0],
    sudoService as unknown as Deps[1],
  );
  return { router, accountService, sudoService };
};

const buildCtx = () => {
  const { req, res } = expressMocks({ headers: { 'user-agent': 'jest-ua' } });
  return {
    req,
    res,
    ctx: {
      req,
      res,
      user: { id: 'u-1', email: 'e@x.io', role: 'USER', emailVerified: true },
      session: { id: 'sess-1', token: 'raw' },
    },
  };
};

describe('OAuthAccountsRouter', () => {
  describe('listAccounts', () => {
    it('returns the session user accounts wrapped in { accounts }', async () => {
      const { router, accountService } = buildRouter();
      const rows = [
        {
          id: 'oa-1',
          provider: 'google',
          email: 'e@x.io',
          createdAt: new Date('2026-01-01'),
          lastUsedAt: new Date('2026-02-01'),
        },
      ];
      accountService.listAccounts.mockResolvedValue(rows);
      const { ctx } = buildCtx();

      const result = await router.listAccounts(
        ctx as unknown as Parameters<typeof router.listAccounts>[0],
      );

      expect(accountService.listAccounts).toHaveBeenCalledWith('u-1');
      expect(result).toEqual({ accounts: rows });
    });

    it('needs no sudo: reading the list is not account surgery', async () => {
      const { router, sudoService } = buildRouter();
      const { ctx } = buildCtx();

      await router.listAccounts(ctx as unknown as Parameters<typeof router.listAccounts>[0]);

      expect(sudoService.isActive).not.toHaveBeenCalled();
    });
  });

  describe('unlink', () => {
    it('refuses without a live sudo grant (FORBIDDEN = re-prompt the password dialog)', async () => {
      const { router, accountService, sudoService } = buildRouter();
      sudoService.isActive.mockResolvedValue(false);
      const { ctx } = buildCtx();

      await expect(
        router.unlink({ accountId: 'oa-1' }, ctx as unknown as Parameters<typeof router.unlink>[1]),
      ).rejects.toMatchObject({ appCode: AppErrorCode.FORBIDDEN });
      expect(accountService.unlink).not.toHaveBeenCalled();
    });

    it('checks the sudo grant of THIS session and delegates with request attribution', async () => {
      const { router, accountService, sudoService } = buildRouter();
      const { ctx } = buildCtx();

      const result = await router.unlink(
        { accountId: 'oa-1' },
        ctx as unknown as Parameters<typeof router.unlink>[1],
      );

      expect(sudoService.isActive).toHaveBeenCalledWith('sess-1');
      expect(accountService.unlink).toHaveBeenCalledWith('u-1', 'oa-1', {
        ip: expect.any(String),
        userAgent: 'jest-ua',
      });
      expect(result).toEqual({ success: true });
    });

    it('propagates the service invariant rejection (last credential)', async () => {
      const { router, accountService } = buildRouter();
      accountService.unlink.mockRejectedValue(
        Object.assign(new Error('last credential'), { appCode: AppErrorCode.PASSWORD_NOT_SET }),
      );
      const { ctx } = buildCtx();

      await expect(
        router.unlink({ accountId: 'oa-1' }, ctx as unknown as Parameters<typeof router.unlink>[1]),
      ).rejects.toMatchObject({ appCode: AppErrorCode.PASSWORD_NOT_SET });
    });
  });
});
