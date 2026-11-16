import type { Request } from 'express';
import { TrpcRequestContextMiddleware } from './trpc-request-context.middleware';
import { requestContext } from '../context/request-context';
import type { IRequestContext } from '../context/request-context';

const buildReq = (overrides: Partial<Request> = {}): Request =>
  ({
    method: 'POST',
    originalUrl: '/trpc/users.list?batch=1&input=%7B%22search%22%3A%2244051401359%22%7D',
    headers: {},
    ip: '203.0.113.7',
    ...overrides,
  }) as unknown as Request;

const buildOpts = (req: Request | undefined, path = 'users.list') => {
  const seen: {
    store: IRequestContext | undefined;
    nextCtx: Record<string, unknown> | undefined;
  } = { store: undefined, nextCtx: undefined };
  const next = jest
    .fn()
    .mockImplementation(async (nextOpts?: { ctx?: Record<string, unknown> }) => {
      seen.store = requestContext.getStore();
      seen.nextCtx = nextOpts?.ctx;
      return 'next-result';
    });
  const ctx: Record<string, unknown> = req === undefined ? {} : { req };
  return {
    seen,
    next,
    ctx,
    opts: {
      ctx,
      next,
      path,
    } as unknown as Parameters<TrpcRequestContextMiddleware['use']>[0],
  };
};

describe('TrpcRequestContextMiddleware', () => {
  const subject = new TrpcRequestContextMiddleware();

  it('opens an ALS scope for a procedure that would otherwise have none', async () => {
    const { opts, seen } = buildOpts(buildReq());

    await expect(subject.use(opts)).resolves.toBe('next-result');

    expect(seen.store).toBeDefined();
    expect(seen.store?.requestId).toEqual(expect.any(String));
  });

  it('takes `path` from the procedure name, never from the URL', async () => {
    // httpBatchLink serializes query inputs into the URL, so a read
    // carries record identifiers there. `path` exists to be logged.
    const { opts, seen } = buildOpts(buildReq());

    await subject.use(opts);

    expect(seen.store?.path).toBe('trpc/users.list');
    expect(seen.store?.path).not.toContain('44051401359');
  });

  it('copies an outer store instead of adopting it, so a batch cannot share one', async () => {
    const outer: IRequestContext = { requestId: 'outer-id' };
    const { opts, seen } = buildOpts(buildReq());

    await requestContext.run(outer, async () => subject.use(opts));

    // Correlation is inherited...
    expect(seen.store?.requestId).toBe('outer-id');
    // ...but the object is not shared, so a sibling procedure's userId write
    // cannot be observed through it.
    expect(seen.store).not.toBe(outer);
  });

  it('re-derives `path` when inheriting, so an outer URL-derived path cannot carry query inputs', async () => {
    const outer: IRequestContext = {
      requestId: 'outer-id',
      path: '/trpc/users.list?batch=1&input=%7B%22search%22%3A%2244051401359%22%7D',
    };
    const { opts, seen } = buildOpts(buildReq());

    await requestContext.run(outer, async () => subject.use(opts));

    expect(seen.store?.path).toBe('trpc/users.list');
    expect(seen.store?.path).not.toContain('44051401359');
  });

  it('shares one requestId and dedupeNonce across every procedure of a batch', async () => {
    // One HTTP request, two procedures: correlation must survive per-procedure
    // scoping, and the dedupe key must not fan out into several.
    const req = buildReq();
    const first = buildOpts(req, 'users.list');
    const second = buildOpts(req, 'audit.list');

    await Promise.all([subject.use(first.opts), subject.use(second.opts)]);

    expect(first.seen.store?.requestId).toBe(second.seen.store?.requestId);
    expect(first.seen.store?.dedupeNonce).toBe(second.seen.store?.dedupeNonce);
    // …while the per-procedure fields still differ.
    expect(first.seen.store?.path).toBe('trpc/users.list');
    expect(second.seen.store?.path).toBe('trpc/audit.list');
  });

  it('mints dedupeNonce server-side, never from the caller-supplied request id', async () => {
    // The nonce keys BullMQ job ids for the security-notification mails; a
    // caller who could choose it could suppress their own 2FA alerts.
    const { opts, seen } = buildOpts(
      buildReq({ headers: { 'x-request-id': 'attacker-pinned-id' } as Request['headers'] }),
    );

    await subject.use(opts);

    expect(seen.store?.requestId).toBe('attacker-pinned-id');
    expect(seen.store?.dedupeNonce).toBeDefined();
    expect(seen.store?.dedupeNonce).not.toBe('attacker-pinned-id');
  });

  it('opens a synthetic scope when there is no express request, rather than none', async () => {
    // AuthMiddleware treats a missing store as a wiring defect and throws, so
    // passing through here would 500 every authenticated procedure on a future
    // transport that has no `req`.
    const { opts, seen } = buildOpts(undefined);

    await expect(subject.use(opts)).resolves.toBe('next-result');

    expect(seen.store).toBeDefined();
    expect(seen.store?.path).toBe('trpc/users.list');
  });

  it('leaves the outer store unmutated when the procedure writes to its own', async () => {
    const outer: IRequestContext = { requestId: 'outer-id' };
    const req = buildReq();
    const next = jest.fn().mockImplementation(async () => {
      const store = requestContext.getStore();
      if (store) store.userId = 'user-from-procedure';
      return 'next-result';
    });
    const opts = {
      ctx: { req },
      next,
      path: 'compliance.settingsGet',
    } as unknown as Parameters<TrpcRequestContextMiddleware['use']>[0];

    await requestContext.run(outer, async () => subject.use(opts));

    expect(outer.userId).toBeUndefined();
  });

  it('rejects a malformed inbound x-request-id rather than trusting it', async () => {
    // The value lands in AuditLog.correlationId, so unbounded caller text there
    // would be a way to write into the audit trail.
    const { opts, seen } = buildOpts(
      buildReq({ headers: { 'x-request-id': 'a'.repeat(500) } as Request['headers'] }),
    );

    await subject.use(opts);

    expect(seen.store?.requestId).not.toHaveLength(500);
  });

  it('accepts a well-formed inbound x-request-id', async () => {
    const { opts, seen } = buildOpts(
      buildReq({ headers: { 'x-request-id': 'req-abc.123:xyz' } as Request['headers'] }),
    );

    await subject.use(opts);

    expect(seen.store?.requestId).toBe('req-abc.123:xyz');
  });

  describe('publishing requestId onto the tRPC context', () => {
    // tRPC rethrows a procedure failure above every middleware and calls
    // `onError` after `requestContext.run` has returned, so AppErrorHandler
    // cannot read the ALS. It reads `opts.ctx.requestId` instead, and the object
    // it receives is the one this middleware was handed; `next({ ctx })` alone
    // builds a fresh object for downstream and never reaches the error path.
    it('writes requestId onto the ctx object the error handler will receive', async () => {
      const { opts, ctx, seen } = buildOpts(
        buildReq({ headers: { 'x-request-id': 'req-abc.123:xyz' } as Request['headers'] }),
      );

      await subject.use(opts);

      expect(ctx['requestId']).toBe('req-abc.123:xyz');
      expect(ctx['requestId']).toBe(seen.store?.requestId);
    });

    it('publishes the same id the ALS store carries when none was supplied', async () => {
      const { opts, ctx, seen } = buildOpts(buildReq());

      await subject.use(opts);

      expect(ctx['requestId']).toEqual(expect.any(String));
      expect(ctx['requestId']).toBe(seen.store?.requestId);
    });

    it('publishes an inherited outer requestId, not a freshly minted one', async () => {
      const outer: IRequestContext = { requestId: 'outer-id' };
      const { opts, ctx } = buildOpts(buildReq());

      await requestContext.run(outer, async () => subject.use(opts));

      expect(ctx['requestId']).toBe('outer-id');
    });

    it('also hands requestId to downstream middlewares via next({ ctx })', async () => {
      const { opts, seen } = buildOpts(buildReq());

      await subject.use(opts);

      expect(seen.nextCtx).toEqual({ requestId: seen.store?.requestId });
    });

    it('publishes the synthetic id when there is no express request', async () => {
      const { opts, ctx, seen } = buildOpts(undefined);

      await subject.use(opts);

      expect(ctx['requestId']).toBe(seen.store?.requestId);
      expect(ctx['requestId']).toEqual(expect.stringMatching(/^trpc-/));
    });

    it('publishes one shared id across every procedure of a batch', async () => {
      // One HTTP request means one ctx object, so the write must be the same
      // value from every procedure rather than a per-procedure one racing on it.
      const req = buildReq();
      const first = buildOpts(req, 'users.list');
      const second = buildOpts(req, 'audit.list');

      await Promise.all([subject.use(first.opts), subject.use(second.opts)]);

      expect(first.ctx['requestId']).toBe(second.ctx['requestId']);
    });

    it('does not throw when there is no ctx object to publish onto', async () => {
      const next = jest.fn().mockResolvedValue('next-result');
      const opts = {
        ctx: undefined,
        next,
        path: 'users.list',
      } as unknown as Parameters<TrpcRequestContextMiddleware['use']>[0];

      await expect(subject.use(opts)).resolves.toBe('next-result');
    });
  });
});
