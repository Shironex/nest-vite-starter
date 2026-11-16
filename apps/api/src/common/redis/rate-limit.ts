import type Redis from 'ioredis';
import { RateLimitError } from '../errors';
import { RedisKeys } from './redis-keys';

/**
 * Generic Redis fixed-window limiter: at most `limit` hits per `windowSeconds`
 * for the given scope. INCR + EXPIRE NX run in one MULTI/EXEC so a crash can
 * never strand a counter without a TTL (which would limit the scope forever).
 * The NX flag (Redis >= 7) only arms the TTL when the key has none, so
 * subsequent hits never slide the window.
 *
 * A plain function (not a service) on purpose: callers outside the auth module
 * (e.g. data-export) can enforce a limit with just the global REDIS_CLIENT,
 * without importing AuthModule and disturbing the cycle-breaker pattern.
 * AuthSharedService.enforceRateLimit delegates here.
 */
export async function enforceFixedWindowLimit(
  redis: Redis,
  scope: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const key = RedisKeys.rateLimit(scope);
  const replies = await redis.multi().incr(key).expire(key, windowSeconds, 'NX').exec();

  const [incrError, count] = replies?.[0] ?? [null, 0];
  if (incrError) {
    throw incrError;
  }
  if (Number(count) > limit) {
    throw new RateLimitError();
  }
}
