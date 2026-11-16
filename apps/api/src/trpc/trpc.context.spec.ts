import type { Request, Response } from 'express';
import type { ContextOptions } from 'nestjs-trpc';
import { AppContext } from './trpc.context';

describe('AppContext', () => {
  let ctx: AppContext;

  beforeEach(() => {
    ctx = new AppContext();
  });

  it('returns { req, res, user: null, session: null } from create()', async () => {
    const req = { headers: {} } as unknown as Request;
    const res = { setHeader: jest.fn() } as unknown as Response;

    const result = await ctx.create({ req, res } as unknown as ContextOptions);

    expect(result).toEqual({ req, res, user: null, session: null });
  });

  it('returns a fresh object distinct from the input opts', async () => {
    const req = {} as unknown as Request;
    const res = {} as unknown as Response;
    const opts = { req, res } as unknown as ContextOptions;

    const result = await ctx.create(opts);

    expect(result).not.toBe(opts);
    expect(result.req).toBe(req);
    expect(result.res).toBe(res);
  });
});
