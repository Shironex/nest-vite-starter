import { expressMocks } from '@test/fixtures';
import { SessionsRouter } from './sessions.router';

type Deps = ConstructorParameters<typeof SessionsRouter>;

const buildRouter = () => {
  const sessionManagement = {
    listSessions: jest.fn().mockResolvedValue([]),
    revokeSession: jest.fn().mockResolvedValue(undefined),
    revokeOtherSessions: jest.fn().mockResolvedValue(undefined),
  };
  const router = new SessionsRouter(sessionManagement as unknown as Deps[0]);
  return { router, sessionManagement };
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
      session: { id: 'sess-1', token: 'raw-token' },
    },
  };
};

describe('SessionsRouter', () => {
  describe('list', () => {
    it('scopes the query to the caller and their current session', async () => {
      const { router, sessionManagement } = buildRouter();
      const rows = [
        {
          id: 'a'.repeat(64),
          ip: '1.2.3.4',
          userAgent: 'jest-ua',
          createdAt: 1,
          lastActive: 2,
          isCurrent: true,
        },
      ];
      sessionManagement.listSessions.mockResolvedValue(rows);
      const { ctx } = buildCtx();

      const result = await router.list(ctx as unknown as Parameters<typeof router.list>[0]);

      expect(sessionManagement.listSessions).toHaveBeenCalledWith('u-1', 'sess-1');
      expect(result).toEqual(rows);
    });
  });

  describe('revoke', () => {
    it('revokes the named handle for the CALLER only and acks', async () => {
      const { router, sessionManagement } = buildRouter();
      const { ctx } = buildCtx();
      const sessionId = 'b'.repeat(64);

      const result = await router.revoke(
        { sessionId },
        ctx as unknown as Parameters<typeof router.revoke>[1],
      );

      expect(sessionManagement.revokeSession).toHaveBeenCalledWith('u-1', sessionId, {
        ip: expect.any(String),
        userAgent: 'jest-ua',
      });
      expect(result).toEqual({ success: true });
    });
  });

  describe('revokeOthers', () => {
    it('hands the CURRENT session token to the service with the live req/res', async () => {
      const { router, sessionManagement } = buildRouter();
      const { ctx, req, res } = buildCtx();

      const result = await router.revokeOthers(
        ctx as unknown as Parameters<typeof router.revokeOthers>[0],
      );

      expect(sessionManagement.revokeOtherSessions).toHaveBeenCalledWith(
        'raw-token',
        expect.any(String),
        'jest-ua',
        req,
        res,
      );
      expect(result).toEqual({ success: true });
    });
  });
});
