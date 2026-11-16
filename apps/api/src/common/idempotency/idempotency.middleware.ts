import { Inject, Injectable, Logger } from '@nestjs/common';
import type { TRPCMiddleware, MiddlewareOptions, MiddlewareResponse } from 'nestjs-trpc';
import { TRPCError } from '@trpc/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { RedisKeys } from '../redis/redis-keys';
import type { IAppContextType } from '../../trpc/trpc.context';

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/**
 * How long an IN-FLIGHT claim may sit unreleased before a retry may take it.
 *
 * Deliberately NOT the 24h success TTL. The claim is released by the same
 * process that took it, so a process death between the claim and the release
 * (a deploy, an OOM kill, a SIGKILL mid-procedure) leaves a record that answers
 * every retry with CONFLICT for a full day. The web hook keeps its key until
 * `onSuccess`, so every "try again" from that form instance hits the same wall,
 * and a client that persists keys is locked out of the operation entirely.
 *
 * 120 seconds is the horizon: comfortably longer than any mutation here (the
 * slowest wrap encryption bytes and enqueue mail; Prisma's own interactive
 * transaction budget is 5 s) and short enough that a killed pod is forgiven
 * within one retry a person would actually make. A claim that outlives it is
 * treated as a miss, which is the safe direction: the worst case is the
 * procedure running twice after a two-minute gap, which is the same exposure a
 * client that never sent a key has, and every keyed procedure is already
 * idempotent by predicate or CAS.
 */
const IDEMPOTENCY_PENDING_TTL_SECONDS = 120;

const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

interface ICachedSuccess {
  ok: true;
  data: unknown;
}

interface IPendingClaim {
  pending: true;
}

// Runtime schemas for the two envelope shapes this middleware itself writes.
// The cached entry round-trips through Redis (external state a different
// deploy, a manual redis-cli edit, or corruption can change), so the replay
// path must validate before handing `data` back to a client. Any shape that
// matches neither is treated as a cache miss, never replayed.
const cachedSuccessSchema = z.object({ ok: z.literal(true), data: z.unknown() });
const pendingClaimSchema = z.object({ pending: z.literal(true) });

/**
 * Idempotency-Key middleware for mutation routers.
 *
 * Wiring: method-level, AFTER auth, as the LAST entry of the full ordered
 * chain the repo convention declares per method, e.g.
 * `@UseMiddlewares(AuthMiddleware, IdempotencyMiddleware)` or
 * `@UseMiddlewares(AuthMiddleware, AdminMiddleware, IdempotencyMiddleware)`.
 * It must NOT go in `globalMiddlewares` (app.module.ts): global tRPC
 * middlewares run before route-level AuthMiddleware, so `ctx.user` would
 * never be populated and every request would take the unauthenticated
 * pass-through below. That pass-through is kept as defense in depth for any
 * future mis-wiring. The providing IdempotencyModule must be imported by the
 * router's module.
 *
 * Contract (wired after AuthMiddleware):
 *   - Client sends `Idempotency-Key: <uuid>` on mutating requests it wants
 *     deduplicated. UUIDs strongly recommended; any string up to 200 chars
 *     accepted.
 *   - Server keys Redis on `idem:[<tenantId>:]<userId>:<path>:<sha256(key+body)>`
 *     so the same key with a different payload doesn't collide (per Stripe's
 *     idempotency contract), and neither users nor tenants can share a record.
 *   - First call: atomically claim the key (SET NX) as pending for
 *     IDEMPOTENCY_PENDING_TTL_SECONDS, run the procedure, overwrite the claim
 *     with the response and promote it to the 24h replay TTL.
 *   - Subsequent calls with the same key + body: return the cached response
 *     without re-running the procedure.
 *   - Concurrent call while the first is still executing: CONFLICT error
 *     (Stripe-style), so the same mutation can never run twice in parallel.
 *   - A claim left behind by a process that died is forgiven after the pending
 *     TTL and read as a miss, rather than answering CONFLICT for a day.
 *   - No header, or no authenticated user -> pass through, no caching. The
 *     unauthenticated bypass is fail-safe: without a user the key would
 *     collapse to a shared 'anon' scope, letting unauthenticated replays read
 *     other callers' cached authenticated responses.
 *
 * NOTE: errors are NOT cached, and a failed run deletes its pending claim. A
 * failed mutation can be retried with the same key; the client expects
 * "either it worked or it didn't, deterministically."
 */
@Injectable()
export class IdempotencyMiddleware implements TRPCMiddleware {
  private readonly logger = new Logger(IdempotencyMiddleware.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async use(opts: MiddlewareOptions): Promise<Awaited<MiddlewareResponse>> {
    const { ctx, next, type, path, getRawInput } = opts;

    // Only apply on mutations. Queries are read-only and safe to repeat.
    if (type !== 'mutation') {
      return next();
    }

    const req = (ctx as IAppContextType).req;
    const idempotencyKey = req.headers['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
      return next();
    }
    if (idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      this.logger.warn('Idempotency-Key too long, ignoring', {
        length: idempotencyKey.length,
      });
      return next();
    }

    // Fail-safe: no authenticated user -> pass through with NO caching. A
    // shared anonymous scope would let one caller's cached response be
    // replayed to another (and to unauthenticated requests). Defense in
    // depth: this branch only fires if the middleware is ever wired before
    // AuthMiddleware (or globally) again.
    const user = (ctx as IAppContextType).user;
    if (!user) {
      return next();
    }

    const rawInput = await getRawInput();
    const bodyHash = createHash('sha256')
      .update(idempotencyKey)
      .update('|')
      .update(JSON.stringify(rawInput ?? null))
      .digest('hex');

    // Scope by tenant when the context carries one so two tenants can never
    // share an idempotency record.
    const tenantId = (ctx as IAppContextType).tenantId;
    const scope = tenantId ? `${tenantId}:${user.id}` : user.id;
    const cacheKey = RedisKeys.idempotency(scope, path, bodyHash);

    // Stripe-style claim: SET NX wins exactly once. The loser reads the
    // existing record and either replays a completed result or reports the
    // in-flight execution as a conflict.
    const pendingClaim: IPendingClaim = { pending: true };
    const claimed = await this.redis.set(
      cacheKey,
      JSON.stringify(pendingClaim),
      'EX',
      IDEMPOTENCY_PENDING_TTL_SECONDS,
      'NX',
    );

    if (claimed === null) {
      const existing = await this.redis.get(cacheKey);
      if (existing) {
        let envelope: unknown;
        try {
          envelope = JSON.parse(existing);
        } catch {
          // Not JSON at all: treated as a miss below.
          envelope = undefined;
        }

        const success = cachedSuccessSchema.safeParse(envelope);
        if (success.success) {
          this.logger.log(`Idempotency replay [${path}] ${idempotencyKey.slice(0, 8)}...`);
          return { ok: true, data: success.data.data };
        }

        const pending = pendingClaimSchema.safeParse(envelope);
        if (pending.success) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'A request with this idempotency key is already in progress',
          });
        }
        // Parsed but matches neither envelope shape: malformed entry, fall
        // through and run the procedure uncached (cache-miss semantics).
      }
      // Record vanished between the failed claim and the read (TTL/expiry
      // race) or was malformed: run the procedure without caching.
      return next();
    }

    let result: Awaited<MiddlewareResponse>;
    try {
      result = await next();
    } catch (err) {
      // The procedure threw: release the pending claim so a legitimate retry
      // with the same key can run instead of hitting CONFLICT for 24h.
      await this.deleteClaim(cacheKey);
      throw err;
    }

    if (result.ok) {
      try {
        const cachedResult: ICachedSuccess = { ok: true, data: result.data };
        // Overwrite the claim and PROMOTE the TTL: the claim carried only the
        // short in-flight horizon, and the replay window the client is
        // promised starts here, when there is finally a response to replay.
        // `XX` keeps a claim that expired underneath a slow procedure from
        // being resurrected as a success nobody is waiting on.
        await this.redis.set(
          cacheKey,
          JSON.stringify(cachedResult),
          'EX',
          IDEMPOTENCY_TTL_SECONDS,
          'XX',
        );
      } catch (err) {
        this.logger.warn('Failed to write idempotency cache', {
          cacheKey,
          error: err instanceof Error ? err.message : String(err),
        });
        // Best-effort: drop the pending claim so retries are not blocked by
        // a claim that will never be completed.
        await this.deleteClaim(cacheKey);
      }
    } else {
      // Errored responses are not cached; release the claim for retries.
      await this.deleteClaim(cacheKey);
    }

    return result;
  }

  private async deleteClaim(cacheKey: string): Promise<void> {
    try {
      await this.redis.del(cacheKey);
    } catch (err) {
      this.logger.warn('Failed to release idempotency claim', {
        cacheKey,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
