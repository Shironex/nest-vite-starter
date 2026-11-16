import { ForbiddenError } from '../../../common/errors';
import { AdminMiddleware } from './role.middleware';

const buildOpts = (user: { id: string; role: string } | null) => {
  const next = jest.fn().mockResolvedValue('next-result');
  return {
    next,
    opts: {
      ctx: { req: {}, res: {}, user, session: null },
      next,
    } as unknown as Parameters<AdminMiddleware['use']>[0],
  };
};

describe('AdminMiddleware', () => {
  let middleware: AdminMiddleware;

  beforeEach(() => {
    middleware = new AdminMiddleware();
  });

  it('throws FORBIDDEN when ctx.user is missing', async () => {
    const { opts, next } = buildOpts(null);
    await expect(middleware.use(opts)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(middleware.use(opts)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Admin access required',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('throws FORBIDDEN when user.role !== ADMIN', async () => {
    const { opts, next } = buildOpts({ id: 'u-1', role: 'USER' });
    await expect(middleware.use(opts)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Admin access required',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls and returns next() when user.role === ADMIN', async () => {
    const { opts, next } = buildOpts({ id: 'u-1', role: 'ADMIN' });
    await expect(middleware.use(opts)).resolves.toBe('next-result');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
