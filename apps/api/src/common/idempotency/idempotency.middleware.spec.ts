import { TRPCError } from '@trpc/server';
import { IdempotencyMiddleware } from './idempotency.middleware';
import { buildRedisMock, type RedisMock } from '../../../test/test-module';
import { expressMocks } from '../../../test/fixtures';

type MwOpts = Parameters<IdempotencyMiddleware['use']>[0];

const authedUser = { id: 'u-1', email: 'e', role: 'USER', emailVerified: true };

const buildOpts = (
  init: {
    type?: 'mutation' | 'query' | 'subscription';
    headers?: Record<string, string>;
    user?: { id: string; email: string; role: string; emailVerified: boolean } | null;
    tenantId?: string;
    rawInput?: unknown;
    nextResult?: { ok: boolean; data?: unknown };
    path?: string;
  } = {},
) => {
  const { req, res } = expressMocks({ headers: init.headers ?? {} });
  const next = jest
    .fn()
    .mockResolvedValue(init.nextResult ?? { ok: true, data: { hello: 'world' } });
  return {
    next,
    opts: {
      type: init.type ?? 'mutation',
      path: init.path ?? 'user.update',
      ctx: {
        req,
        res,
        user: init.user ?? null,
        session: null,
        ...(init.tenantId !== undefined ? { tenantId: init.tenantId } : {}),
      },
      next,
      getRawInput: jest.fn().mockResolvedValue(init.rawInput ?? { foo: 'bar' }),
    } as unknown as MwOpts,
  };
};

describe('IdempotencyMiddleware', () => {
  let redis: RedisMock;
  let middleware: IdempotencyMiddleware;

  beforeEach(() => {
    redis = buildRedisMock();
    middleware = new IdempotencyMiddleware(redis as unknown as never);
  });

  describe('passthrough cases', () => {
    it('passes through queries without touching Redis', async () => {
      const { opts, next } = buildOpts({
        type: 'query',
        headers: { 'idempotency-key': 'k' },
        user: authedUser,
      });
      await middleware.use(opts);
      expect(next).toHaveBeenCalledTimes(1);
      expect(redis.get).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('passes through when Idempotency-Key header is missing', async () => {
      const { opts, next } = buildOpts({ user: authedUser });
      await middleware.use(opts);
      expect(next).toHaveBeenCalledTimes(1);
      expect(redis.get).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('passes through when Idempotency-Key is an empty string', async () => {
      const { opts, next } = buildOpts({
        headers: { 'idempotency-key': '' },
        user: authedUser,
      });
      await middleware.use(opts);
      expect(next).toHaveBeenCalledTimes(1);
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('warns and passes through when Idempotency-Key exceeds 200 chars', async () => {
      const warnSpy = jest
        .spyOn((middleware as unknown as { logger: { warn: jest.Mock } }).logger, 'warn')
        .mockImplementation(() => undefined);
      const { opts, next } = buildOpts({
        headers: { 'idempotency-key': 'a'.repeat(201) },
        user: authedUser,
      });
      await middleware.use(opts);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('too long'), { length: 201 });
      expect(next).toHaveBeenCalledTimes(1);
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('fail-safe: passes through with NO caching when ctx.user is absent (defense in depth against pre-auth wiring)', async () => {
      const { opts, next } = buildOpts({ headers: { 'idempotency-key': 'k' } });
      const result = await middleware.use(opts);
      expect(next).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: true, data: { hello: 'world' } });
      // Never reads or writes Redis: an anonymous scope would let
      // unauthenticated replays read cached authenticated responses.
      expect(redis.get).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  describe('first call (claim wins)', () => {
    it('claims for 120s, runs next(), then promotes the record to the 24h replay TTL', async () => {
      redis.set.mockResolvedValue('OK');
      const { opts, next } = buildOpts({
        headers: { 'idempotency-key': 'key-1' },
        user: authedUser,
      });
      const result = await middleware.use(opts);
      expect(next).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: true, data: { hello: 'world' } });
      // 1st write: pending claim, atomic create-if-absent, SHORT horizon. The
      // claim is released by this process, so a process death between the two
      // writes must not answer every retry with CONFLICT for a day.
      expect(redis.set).toHaveBeenNthCalledWith(
        1,
        expect.stringMatching(/^idem:u-1:user\.update:[a-f0-9]{64}$/),
        JSON.stringify({ pending: true }),
        'EX',
        120,
        'NX',
      );
      // 2nd write: completed result, in place, promoted to the replay TTL the
      // client is actually promised.
      expect(redis.set).toHaveBeenNthCalledWith(
        2,
        expect.stringMatching(/^idem:u-1:user\.update:[a-f0-9]{64}$/),
        JSON.stringify({ ok: true, data: { hello: 'world' } }),
        'EX',
        86400,
        'XX',
      );
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('prefixes the cache key with tenantId when the context carries one', async () => {
      redis.set.mockResolvedValue('OK');
      const { opts } = buildOpts({
        headers: { 'idempotency-key': 'k' },
        user: authedUser,
        tenantId: 't-9',
      });
      await middleware.use(opts);
      expect(redis.set).toHaveBeenCalledWith(
        expect.stringMatching(/^idem:t-9:u-1:user\.update:[a-f0-9]{64}$/),
        expect.any(String),
        'EX',
        120,
        'NX',
      );
    });

    it('releases the claim (DEL) and does NOT cache when result.ok === false', async () => {
      redis.set.mockResolvedValue('OK');
      const { opts } = buildOpts({
        headers: { 'idempotency-key': 'k' },
        user: authedUser,
        nextResult: { ok: false },
      });
      await middleware.use(opts);
      // Only the claim write; no completion write.
      expect(redis.set).toHaveBeenCalledTimes(1);
      expect(redis.del).toHaveBeenCalledTimes(1);
    });

    it('releases the claim (DEL) and rethrows when the procedure throws', async () => {
      redis.set.mockResolvedValue('OK');
      const { opts, next } = buildOpts({
        headers: { 'idempotency-key': 'k' },
        user: authedUser,
      });
      next.mockRejectedValue(new Error('boom'));
      await expect(middleware.use(opts)).rejects.toThrow('boom');
      expect(redis.del).toHaveBeenCalledTimes(1);
      // Only the claim write happened.
      expect(redis.set).toHaveBeenCalledTimes(1);
    });

    it('logs, releases the claim, and still returns the result when the completion write rejects', async () => {
      redis.set.mockResolvedValueOnce('OK').mockRejectedValueOnce(new Error('redis down'));
      const warnSpy = jest
        .spyOn((middleware as unknown as { logger: { warn: jest.Mock } }).logger, 'warn')
        .mockImplementation(() => undefined);
      const { opts } = buildOpts({ headers: { 'idempotency-key': 'k' }, user: authedUser });
      const result = await middleware.use(opts);
      expect(result).toEqual({ ok: true, data: { hello: 'world' } });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to write idempotency'),
        expect.objectContaining({ cacheKey: expect.any(String), error: 'redis down' }),
      );
      expect(redis.del).toHaveBeenCalledTimes(1);
    });
  });

  describe('claim lost (key already exists)', () => {
    it('returns the cached payload without calling next() when the record is completed', async () => {
      redis.set.mockResolvedValue(null);
      redis.get.mockResolvedValue(JSON.stringify({ ok: true, data: { cached: 'yes' } }));
      const { opts, next } = buildOpts({ headers: { 'idempotency-key': 'k' }, user: authedUser });
      const result = await middleware.use(opts);
      expect(result).toEqual({ ok: true, data: { cached: 'yes' } });
      expect(next).not.toHaveBeenCalled();
    });

    it('throws CONFLICT when the record is still pending (concurrent same-key request)', async () => {
      redis.set.mockResolvedValue(null);
      redis.get.mockResolvedValue(JSON.stringify({ pending: true }));
      const { opts, next } = buildOpts({ headers: { 'idempotency-key': 'k' }, user: authedUser });
      const failure = middleware.use(opts);
      await expect(failure).rejects.toBeInstanceOf(TRPCError);
      await expect(failure).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'A request with this idempotency key is already in progress',
      });
      expect(next).not.toHaveBeenCalled();
      // The loser must never delete the winner's claim.
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('falls through to next() uncached when the existing record is malformed JSON', async () => {
      redis.set.mockResolvedValue(null);
      redis.get.mockResolvedValue('{not json');
      const { opts, next } = buildOpts({ headers: { 'idempotency-key': 'k' }, user: authedUser });
      const result = await middleware.use(opts);
      expect(next).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: true, data: { hello: 'world' } });
      // Only the failed claim attempt; no completion write for a key we do not own.
      expect(redis.set).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['ok is not the literal true', JSON.stringify({ ok: 'yes', data: { cached: 'no' } })],
      ['pending is not the literal true', JSON.stringify({ pending: 1 })],
      ['neither envelope shape', JSON.stringify({ something: 'else' })],
      ['a bare JSON scalar', JSON.stringify('ok')],
      ['JSON null', JSON.stringify(null)],
    ])(
      'treats an envelope-shape mismatch as a cache miss and never replays it (%s)',
      async (_label, cached) => {
        redis.set.mockResolvedValue(null);
        redis.get.mockResolvedValue(cached);
        const { opts, next } = buildOpts({ headers: { 'idempotency-key': 'k' }, user: authedUser });
        const result = await middleware.use(opts);
        // The unvalidated cached value must NOT be handed back to the client;
        // the procedure runs instead.
        expect(next).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ ok: true, data: { hello: 'world' } });
      },
    );

    // The process-death case, which is what the short claim TTL exists for: the
    // claim outlived its owner, Redis expired it, and the retry is answered by
    // running the procedure rather than by a CONFLICT that would stand for 24h.
    it('treats an expired pending claim as a miss and runs the procedure', async () => {
      redis.set.mockResolvedValueOnce(null).mockResolvedValue('OK');
      redis.get.mockResolvedValue(null);
      const { opts, next } = buildOpts({ headers: { 'idempotency-key': 'k' }, user: authedUser });

      const result = await middleware.use(opts);

      expect(next).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: true, data: { hello: 'world' } });
    });

    it('falls through to next() uncached when the record expired between claim and read', async () => {
      redis.set.mockResolvedValue(null);
      redis.get.mockResolvedValue(null);
      const { opts, next } = buildOpts({ headers: { 'idempotency-key': 'k' }, user: authedUser });
      const result = await middleware.use(opts);
      expect(next).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: true, data: { hello: 'world' } });
      expect(redis.set).toHaveBeenCalledTimes(1);
    });
  });

  describe('cache key derivation', () => {
    const claimKey = () => redis.set.mock.calls[0]?.[0] as string;

    it('produces the same hash for the same key + body', async () => {
      redis.set.mockResolvedValue('OK');
      const a = buildOpts({
        headers: { 'idempotency-key': 'k' },
        rawInput: { x: 1 },
        user: authedUser,
      });
      await middleware.use(a.opts);
      const keyA = claimKey();

      redis.set.mockClear();
      const b = buildOpts({
        headers: { 'idempotency-key': 'k' },
        rawInput: { x: 1 },
        user: authedUser,
      });
      await middleware.use(b.opts);
      const keyB = claimKey();

      expect(keyA).toBe(keyB);
    });

    it('produces different hashes when body differs (Stripe-style)', async () => {
      redis.set.mockResolvedValue('OK');
      const a = buildOpts({
        headers: { 'idempotency-key': 'k' },
        rawInput: { x: 1 },
        user: authedUser,
      });
      await middleware.use(a.opts);
      const keyA = claimKey();

      redis.set.mockClear();
      const b = buildOpts({
        headers: { 'idempotency-key': 'k' },
        rawInput: { x: 2 },
        user: authedUser,
      });
      await middleware.use(b.opts);
      const keyB = claimKey();

      expect(keyA).not.toBe(keyB);
    });

    it('handles undefined rawInput by hashing JSON null', async () => {
      redis.set.mockResolvedValue('OK');
      const { opts } = buildOpts({
        headers: { 'idempotency-key': 'k' },
        rawInput: undefined,
        user: authedUser,
      });
      await expect(middleware.use(opts)).resolves.toBeDefined();
      expect(redis.set).toHaveBeenCalled();
    });
  });
});
