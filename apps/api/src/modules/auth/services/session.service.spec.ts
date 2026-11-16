import { Test } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import RedisMock from 'ioredis-mock';
import type Redis from 'ioredis';
import { AppErrorCode } from '@repo/shared/errors';
import { SessionService } from './session.service';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { RedisKeys } from '../../../common/redis/redis-keys';

const buildSubject = async () => {
  const redis = new RedisMock() as unknown as Redis;
  const module = await Test.createTestingModule({
    providers: [SessionService, { provide: REDIS_CLIENT, useValue: redis }],
  }).compile();
  return { service: module.get(SessionService), redis };
};

const baseParams = {
  userId: 'u-1',
  email: 'e@x.com',
  role: 'USER',
  emailVerified: true,
  ip: '1.2.3.4',
  userAgent: 'jest',
};

/**
 * ioredis-mock instances share one global keyspace, so specs that assert on
 * exact key contents (the epoch counter especially, which only ever counts up)
 * must not reuse a user id another test already touched.
 */
let userSeq = 0;
const freshUser = (): string => `u-fence-${++userSeq}`;

describe('SessionService', () => {
  describe('createSession', () => {
    it('rememberMe: false → 24h TTL', async () => {
      const { service, redis } = await buildSubject();
      const { token } = await service.createSession({ ...baseParams, rememberMe: false });
      const sessionId = createHash('sha256').update(token).digest('hex');
      const ttl = await redis.ttl(RedisKeys.session(sessionId));
      expect(ttl).toBeGreaterThan(24 * 60 * 60 - 5);
      expect(ttl).toBeLessThanOrEqual(24 * 60 * 60);
    });

    it('rememberMe: true → 30d TTL', async () => {
      const { service, redis } = await buildSubject();
      const { token } = await service.createSession({ ...baseParams, rememberMe: true });
      const sessionId = createHash('sha256').update(token).digest('hex');
      const ttl = await redis.ttl(RedisKeys.session(sessionId));
      expect(ttl).toBeGreaterThan(30 * 24 * 60 * 60 - 5);
      expect(ttl).toBeLessThanOrEqual(30 * 24 * 60 * 60);
    });

    it('session ID = sha256(token); cookie holds raw token, Redis holds hash', async () => {
      const { service, redis } = await buildSubject();
      const { token } = await service.createSession({ ...baseParams, rememberMe: false });
      const sessionId = createHash('sha256').update(token).digest('hex');
      const raw = await redis.get(RedisKeys.session(sessionId));
      expect(raw).not.toBeNull();
      // The raw token must NOT exist in Redis under its own key.
      const rawAsKey = await redis.get(RedisKeys.session(token));
      expect(rawAsKey).toBeNull();
    });

    it('adds session ID to user_sessions set', async () => {
      const { service, redis } = await buildSubject();
      const { token } = await service.createSession({ ...baseParams, rememberMe: false });
      const sessionId = createHash('sha256').update(token).digest('hex');
      const members = await redis.smembers(RedisKeys.userSessions('u-1'));
      expect(members).toContain(sessionId);
    });

    it('caps the user_sessions SET with the longest (30d) session TTL', async () => {
      const { service, redis } = await buildSubject();
      await service.createSession({ ...baseParams, rememberMe: false });
      const ttl = await redis.ttl(RedisKeys.userSessions('u-1'));
      // The SET must not live forever for abandoned accounts; it carries the
      // remember-me TTL, refreshed on each new session.
      expect(ttl).toBeGreaterThan(30 * 24 * 60 * 60 - 5);
      expect(ttl).toBeLessThanOrEqual(30 * 24 * 60 * 60);
    });

    it('stores tenantId in the session blob when provided', async () => {
      const { service, redis } = await buildSubject();
      const { token } = await service.createSession({
        ...baseParams,
        rememberMe: false,
        tenantId: 't-1',
      });
      const sessionId = createHash('sha256').update(token).digest('hex');
      const raw = await redis.get(RedisKeys.session(sessionId));
      expect(JSON.parse(raw!)).toMatchObject({ tenantId: 't-1' });
    });

    it('omits tenantId from the blob when not provided (pre-tenancy/platform)', async () => {
      const { service, redis } = await buildSubject();
      const { token } = await service.createSession({ ...baseParams, rememberMe: false });
      const sessionId = createHash('sha256').update(token).digest('hex');
      const raw = await redis.get(RedisKeys.session(sessionId));
      expect('tenantId' in JSON.parse(raw!)).toBe(false);
    });

    it('enforceMaxSessions: evicts oldest when at MAX (3) on a new login', async () => {
      const { service, redis } = await buildSubject();
      // Seed 3 sessions with increasing createdAt.
      const tokens: string[] = [];
      for (let i = 0; i < 3; i++) {
        const { token } = await service.createSession({ ...baseParams, rememberMe: false });
        tokens.push(token);
        // Tiny delay so createdAt differs (Date.now resolution is 1ms).
        await new Promise((r) => setImmediate(r));
      }
      // 4th login → oldest gets evicted, ending at 3 active.
      await service.createSession({ ...baseParams, rememberMe: false });
      const members = await redis.smembers(RedisKeys.userSessions('u-1'));
      expect(members.length).toBe(3);
    });

    it('reports the ids it evicted to the caller', async () => {
      const { service } = await buildSubject();
      // A user nobody else seeded: ioredis-mock shares one global keyspace, so
      // a shared id would arrive already over the cap.
      const userId = freshUser();
      const evictable: string[] = [];
      for (let i = 0; i < 3; i++) {
        const { token } = await service.createSession({ ...baseParams, userId, rememberMe: false });
        evictable.push(createHash('sha256').update(token).digest('hex'));
        await new Promise((r) => setImmediate(r));
      }

      const fourth = await service.createSession({ ...baseParams, userId, rememberMe: false });

      // Reported to the caller rather than acted on here.
      expect(fourth.evictedSessionIds).toEqual([evictable[0]]);
    });

    it('reports no evictions under the cap', async () => {
      const { service } = await buildSubject();
      const first = await service.createSession({
        ...baseParams,
        userId: freshUser(),
        rememberMe: false,
      });
      expect(first.evictedSessionIds).toEqual([]);
    });
  });

  describe('validateSession', () => {
    it('returns null when token is unknown', async () => {
      const { service } = await buildSubject();
      const result = await service.validateSession('not-a-real-token');
      expect(result).toBeNull();
    });

    it('returns session + sessionId and preserves TTL', async () => {
      const { service, redis } = await buildSubject();
      const { token } = await service.createSession({ ...baseParams, rememberMe: false });
      const sessionId = createHash('sha256').update(token).digest('hex');
      const ttlBefore = await redis.ttl(RedisKeys.session(sessionId));

      const result = await service.validateSession(token);

      expect(result).not.toBeNull();
      expect(result!.sessionId).toBe(sessionId);
      expect(result!.userId).toBe('u-1');
      const ttlAfter = await redis.ttl(RedisKeys.session(sessionId));
      expect(Math.abs(ttlBefore - ttlAfter)).toBeLessThanOrEqual(1);
    });

    it('does NOT rewrite the blob when lastActive is fresh (steady-state single GET)', async () => {
      const { service, redis } = await buildSubject();
      const { token } = await service.createSession({ ...baseParams, rememberMe: false });
      const setSpy = jest.spyOn(redis, 'set');
      const setexSpy = jest.spyOn(redis, 'setex');

      const result = await service.validateSession(token);

      expect(result).not.toBeNull();
      // lastActive was written < LAST_ACTIVE_REFRESH_MS ago: no write at all.
      expect(setSpy).not.toHaveBeenCalled();
      expect(setexSpy).not.toHaveBeenCalled();
    });

    it('refreshes lastActive via update-if-exists when the stored value is stale', async () => {
      const { service, redis } = await buildSubject();
      const { token } = await service.createSession({ ...baseParams, rememberMe: false });
      const sessionId = createHash('sha256').update(token).digest('hex');
      const key = RedisKeys.session(sessionId);

      // Age the stored lastActive past the refresh threshold (60s).
      const blob = JSON.parse((await redis.get(key))!) as { lastActive: number };
      const staleLastActive = Date.now() - 5 * 60 * 1000;
      await redis.set(key, JSON.stringify({ ...blob, lastActive: staleLastActive }), 'KEEPTTL');
      const setSpy = jest.spyOn(redis, 'set');

      const result = await service.validateSession(token);

      expect(result).not.toBeNull();
      expect(result!.lastActive).toBeGreaterThan(staleLastActive);
      // The rewrite must be the atomic update-if-exists form: XX (only when the
      // key still exists) + KEEPTTL (never extend the session lifetime).
      expect(setSpy).toHaveBeenCalledWith(key, expect.any(String), 'KEEPTTL', 'XX');
      const stored = JSON.parse((await redis.get(key))!) as { lastActive: number };
      expect(stored.lastActive).toBe(result!.lastActive);
    });

    it('does not resurrect a session revoked between the GET and the refresh write', async () => {
      const { service, redis } = await buildSubject();
      const { token } = await service.createSession({ ...baseParams, rememberMe: false });
      const sessionId = createHash('sha256').update(token).digest('hex');
      const key = RedisKeys.session(sessionId);

      // Simulate the race: the GET observes a stale-lastActive blob, but the
      // session is deleted (revoked) before the refresh write runs.
      const blob = JSON.parse((await redis.get(key))!) as { lastActive: number };
      const staleBlob = JSON.stringify({ ...blob, lastActive: Date.now() - 5 * 60 * 1000 });
      await redis.del(key);
      jest.spyOn(redis, 'get').mockResolvedValueOnce(staleBlob);

      const result = await service.validateSession(token);

      // set ... XX wrote nothing (key gone) -> the session stays revoked.
      expect(result).toBeNull();
      expect(await redis.exists(key)).toBe(0);
    });

    it('returns null when the stored expiresAt has passed (TTL-less key backstop)', async () => {
      const { service, redis } = await buildSubject();
      const { token } = await service.createSession({ ...baseParams, rememberMe: false });
      const sessionId = createHash('sha256').update(token).digest('hex');
      const key = RedisKeys.session(sessionId);

      const blob = JSON.parse((await redis.get(key))!) as { expiresAt: number };
      await redis.set(key, JSON.stringify({ ...blob, expiresAt: Date.now() - 1000 }));

      const result = await service.validateSession(token);
      expect(result).toBeNull();
    });
  });

  describe('enforceMaxSessions stale cleanup', () => {
    it('does not count stale (key-expired) IDs when enforcing MAX', async () => {
      const { service, redis } = await buildSubject();
      // Seed three stale entries (in SET but no session key). If they were
      // counted as "active", a new createSession at MAX would evict, but
      // because they have no backing session blob, the new session should
      // succeed without eviction logic kicking in.
      await redis.sadd(RedisKeys.userSessions('u-1'), 'stale-1', 'stale-2', 'stale-3');

      const { token } = await service.createSession({ ...baseParams, rememberMe: false });
      const newId = createHash('sha256').update(token).digest('hex');

      // The new session was added to the SET.
      const members = await redis.smembers(RedisKeys.userSessions('u-1'));
      expect(members).toContain(newId);
      // The new session blob is reachable.
      expect(await redis.get(RedisKeys.session(newId))).not.toBeNull();
    });
  });

  describe('deleteSession', () => {
    it('removes session key AND removes from user_sessions set', async () => {
      const { service, redis } = await buildSubject();
      const { token } = await service.createSession({ ...baseParams, rememberMe: false });
      const sessionId = createHash('sha256').update(token).digest('hex');

      await service.deleteSession(token);

      expect(await redis.get(RedisKeys.session(sessionId))).toBeNull();
      expect(await redis.smembers(RedisKeys.userSessions('u-1'))).not.toContain(sessionId);
    });

    it('does not throw on already-expired key', async () => {
      const { service } = await buildSubject();
      await expect(service.deleteSession('never-existed')).resolves.toEqual(expect.any(String));
    });

    it('returns the session id it deleted', async () => {
      const { service } = await buildSubject();
      const { token } = await service.createSession({ ...baseParams, rememberMe: false });
      const sessionId = createHash('sha256').update(token).digest('hex');

      // Returned rather than re-derived by the caller: `hashToken` is the one
      // place that knows how a cookie token becomes a session id.
      await expect(service.deleteSession(token)).resolves.toBe(sessionId);
    });
  });

  describe('deleteUserSessionById', () => {
    it('removes the blob AND the SET membership, and reports true', async () => {
      const { service, redis } = await buildSubject();
      const userId = freshUser();
      const { token } = await service.createSession({ ...baseParams, userId, rememberMe: false });
      const sessionId = createHash('sha256').update(token).digest('hex');

      await expect(service.deleteUserSessionById(userId, sessionId)).resolves.toBe(true);

      expect(await redis.get(RedisKeys.session(sessionId))).toBeNull();
      expect(await redis.smembers(RedisKeys.userSessions(userId))).not.toContain(sessionId);
    });

    it("refuses another user's session id: deletes nothing, reports false", async () => {
      const { service, redis } = await buildSubject();
      const owner = freshUser();
      const attacker = freshUser();
      const { token } = await service.createSession({
        ...baseParams,
        userId: owner,
        rememberMe: false,
      });
      const sessionId = createHash('sha256').update(token).digest('hex');

      await expect(service.deleteUserSessionById(attacker, sessionId)).resolves.toBe(false);

      // The owner's session must survive an id guessed (or leaked) to a
      // different caller: ownership is the SET membership, not the id itself.
      expect(await redis.get(RedisKeys.session(sessionId))).not.toBeNull();
      expect(await redis.smembers(RedisKeys.userSessions(owner))).toContain(sessionId);
    });

    it('is idempotent: a second revoke of the same id reports false', async () => {
      const { service } = await buildSubject();
      const userId = freshUser();
      const { token } = await service.createSession({ ...baseParams, userId, rememberMe: false });
      const sessionId = createHash('sha256').update(token).digest('hex');

      await expect(service.deleteUserSessionById(userId, sessionId)).resolves.toBe(true);
      await expect(service.deleteUserSessionById(userId, sessionId)).resolves.toBe(false);
    });

    it('does not bump the epoch: sibling sessions stay valid', async () => {
      const { service } = await buildSubject();
      const userId = freshUser();
      const { token: keepToken } = await service.createSession({
        ...baseParams,
        userId,
        rememberMe: false,
      });
      const { token: dropToken } = await service.createSession({
        ...baseParams,
        userId,
        rememberMe: false,
      });
      const dropId = createHash('sha256').update(dropToken).digest('hex');

      await service.deleteUserSessionById(userId, dropId);

      expect(await service.validateSession(keepToken)).not.toBeNull();
      expect(await service.validateSession(dropToken)).toBeNull();
    });
  });

  describe('isRememberMeSession', () => {
    it('reads a 30-day blob as remember-me and a 24h blob as not', async () => {
      const { service, redis } = await buildSubject();
      const userId = freshUser();
      const { token: shortToken } = await service.createSession({
        ...baseParams,
        userId,
        rememberMe: false,
      });
      const { token: longToken } = await service.createSession({
        ...baseParams,
        userId,
        rememberMe: true,
      });

      const read = async (token: string) => {
        const id = createHash('sha256').update(token).digest('hex');
        return JSON.parse((await redis.get(RedisKeys.session(id)))!) as {
          createdAt: number;
          expiresAt: number;
        };
      };

      expect(service.isRememberMeSession(await read(shortToken))).toBe(false);
      expect(service.isRememberMeSession(await read(longToken))).toBe(true);
    });
  });

  describe('deleteAllUserSessions', () => {
    it('deletes all session keys and the SET in one go', async () => {
      const { service, redis } = await buildSubject();
      await service.createSession({ ...baseParams, rememberMe: false });
      await service.createSession({ ...baseParams, rememberMe: false });

      await service.deleteAllUserSessions('u-1');

      const members = await redis.smembers(RedisKeys.userSessions('u-1'));
      expect(members).toEqual([]);
    });

    it('no-op when SET is empty (does not invoke del with zero keys)', async () => {
      const { service } = await buildSubject();
      await expect(service.deleteAllUserSessions('u-empty')).resolves.toBeUndefined();
    });

    it('bumps the epoch counter and keeps a TTL on it', async () => {
      const { service, redis } = await buildSubject();
      const userId = freshUser();

      await service.deleteAllUserSessions(userId);
      await service.deleteAllUserSessions(userId);

      expect(await redis.get(RedisKeys.sessionEpoch(userId))).toBe('2');
      // A counter without a TTL would outlive the account forever.
      expect(await redis.ttl(RedisKeys.sessionEpoch(userId))).toBeGreaterThan(30 * 24 * 60 * 60);
    });

    it('SREMs the ids it walked instead of DEL-ing the SET, so a concurrent mint is not orphaned', async () => {
      const { service, redis } = await buildSubject();
      const userId = freshUser();
      const setKey = RedisKeys.userSessions(userId);
      await service.createSession({ ...baseParams, userId, rememberMe: false });
      // A session added after the walk read its members (a legitimate
      // post-revocation login). DEL-ing the whole SET would leave its blob
      // alive but unreachable from the index, invisible to "active sessions"
      // and to a later revocation walk.
      const realSmembers = redis.smembers.bind(redis) as (key: string) => Promise<string[]>;
      jest.spyOn(redis, 'smembers').mockImplementationOnce((async (key: string) => {
        const members = await realSmembers(key);
        await redis.sadd(setKey, 'minted-after-the-walk');
        return members;
      }) as never);

      await service.deleteAllUserSessions(userId);

      expect(await redis.smembers(setKey)).toEqual(['minted-after-the-walk']);
    });
  });

  /**
   * The fence itself. Revocation walks the `user_sessions` SET, so
   * it can only delete the sessions it can SEE; a session minted concurrently
   * with the walk is invisible to it and used to survive. These tests drive the
   * interleavings, not just the happy path; each race test asserts that the
   * blob really did survive the revocation, so it fails if the fence stops
   * being the thing that rejects it.
   */
  describe('session-epoch fence', () => {
    /** Write a session blob straight into Redis, bypassing createSession's own
     * fence check: models a mint that completed (or a pre-fence deploy's mint)
     * and therefore is exactly what validateSession must catch on its own. */
    const plantSession = async (
      redis: Redis,
      userId: string,
      token: string,
      blob: Record<string, unknown>,
    ): Promise<string> => {
      const sessionId = createHash('sha256').update(token).digest('hex');
      const now = Date.now();
      await redis
        .multi()
        .sadd(RedisKeys.userSessions(userId), sessionId)
        .setex(
          RedisKeys.session(sessionId),
          3600,
          JSON.stringify({
            ...baseParams,
            userId,
            createdAt: now,
            lastActive: now,
            expiresAt: now + 3600_000,
            ...blob,
          }),
        )
        .exec();
      return sessionId;
    };

    it('stamps the current epoch into the blob and keeps the counter alive', async () => {
      const { service, redis } = await buildSubject();
      const userId = freshUser();
      await service.deleteAllUserSessions(userId); // epoch -> 1

      const { token } = await service.createSession({ ...baseParams, userId, rememberMe: true });

      const sessionId = createHash('sha256').update(token).digest('hex');
      expect(JSON.parse((await redis.get(RedisKeys.session(sessionId)))!)).toMatchObject({
        epoch: 1,
      });
      // The counter must outlive the 30-day session that just stamped it.
      expect(await redis.ttl(RedisKeys.sessionEpoch(userId))).toBeGreaterThan(30 * 24 * 60 * 60);
    });

    it('THE RACE: a session minted mid-walk survives the revocation and is still rejected', async () => {
      const { service, redis } = await buildSubject();
      const userId = freshUser();
      const { token: existing } = await service.createSession({
        ...baseParams,
        userId,
        rememberMe: false,
      });
      const raceToken = `race-${userId}`;
      const raceId = createHash('sha256').update(raceToken).digest('hex');

      // A login that captured epoch 0 lands its Redis write INSIDE the walk:
      // after SMEMBERS (so the walk can never see it), before the walk ends.
      const realSmembers = redis.smembers.bind(redis) as (key: string) => Promise<string[]>;
      jest.spyOn(redis, 'smembers').mockImplementationOnce((async (key: string) => {
        const members = await realSmembers(key);
        await plantSession(redis, userId, raceToken, { epoch: 0 });
        return members;
      }) as never);

      await service.deleteAllUserSessions(userId);

      // The hole: the revocation could not delete this blob. It is still there.
      expect(await redis.get(RedisKeys.session(raceId))).not.toBeNull();
      // The fence is what makes it useless anyway.
      expect(await service.validateSession(raceToken)).toBeNull();
      // ...while the session the walk COULD see died the ordinary way.
      expect(await service.validateSession(existing)).toBeNull();
    });

    it('THE RACE: a mint whose epoch was captured before the revocation is refused outright', async () => {
      const { service } = await buildSubject();
      const userId = freshUser();
      // Captured where a login captures it: before verifying the credential.
      const captured = await service.readEpoch(userId);

      // The whole password-change happens while that login is still verifying.
      await service.deleteAllUserSessions(userId);

      await expect(
        service.createSession({ ...baseParams, userId, rememberMe: false, epoch: captured }),
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        appCode: AppErrorCode.SESSION_EXPIRED,
      });
    });

    it('rolls the refused mint back: no blob, no SET member, no MAX_SESSIONS slot burned', async () => {
      const { service, redis } = await buildSubject();
      const userId = freshUser();
      const captured = await service.readEpoch(userId);
      await service.deleteAllUserSessions(userId);

      await expect(
        service.createSession({ ...baseParams, userId, rememberMe: false, epoch: captured }),
      ).rejects.toThrow();

      expect(await redis.smembers(RedisKeys.userSessions(userId))).toEqual([]);
    });

    it('a mint that captured its epoch AFTER the revocation is a normal login and survives', async () => {
      const { service } = await buildSubject();
      const userId = freshUser();
      await service.deleteAllUserSessions(userId);

      const captured = await service.readEpoch(userId);
      const { token } = await service.createSession({
        ...baseParams,
        userId,
        rememberMe: false,
        epoch: captured,
      });

      // Proof the fence rejects staleness rather than everything: this login
      // read the post-revocation world, so it stays valid.
      expect(await service.validateSession(token)).not.toBeNull();
    });

    it('every session minted before a revocation stops validating, walk or no walk', async () => {
      const { service, redis } = await buildSubject();
      const userId = freshUser();
      const { token } = await service.createSession({ ...baseParams, userId, rememberMe: false });
      const sessionId = createHash('sha256').update(token).digest('hex');
      // Bump the counter only; the blob is left untouched, as if the walk had
      // crashed or never found it.
      await redis.incr(RedisKeys.sessionEpoch(userId));

      expect(await redis.get(RedisKeys.session(sessionId))).not.toBeNull();
      expect(await service.validateSession(token)).toBeNull();
    });

    it('a blob ahead of the counter is rejected too (lost or rolled-back counter)', async () => {
      const { service, redis } = await buildSubject();
      const userId = freshUser();
      const token = `ahead-${userId}`;
      await plantSession(redis, userId, token, { epoch: 7 });

      expect(await service.validateSession(token)).toBeNull();
    });

    it('pre-fence blobs (no epoch field) keep working until the account is first revoked', async () => {
      const { service, redis } = await buildSubject();
      const userId = freshUser();
      const token = `legacy-${userId}`;
      await plantSession(redis, userId, token, {});

      // No deploy-time fleet-wide logout: absent epoch reads as 0, the counter
      // is absent too, so they match.
      expect(await service.validateSession(token)).not.toBeNull();

      await redis.incr(RedisKeys.sessionEpoch(userId));
      expect(await service.validateSession(token)).toBeNull();
    });

    it('single-device logout does NOT bump the epoch (other devices stay signed in)', async () => {
      const { service, redis } = await buildSubject();
      const userId = freshUser();
      const { token: phone } = await service.createSession({
        ...baseParams,
        userId,
        rememberMe: false,
      });
      const { token: laptop } = await service.createSession({
        ...baseParams,
        userId,
        rememberMe: false,
      });

      await service.deleteSession(phone);

      expect(await redis.get(RedisKeys.sessionEpoch(userId))).toBeNull();
      expect(await service.validateSession(laptop)).not.toBeNull();
    });

    it('getUserSessions hides (and reaps) a fenced session the walk missed', async () => {
      const { service, redis } = await buildSubject();
      const userId = freshUser();
      const token = `fenced-${userId}`;
      const sessionId = await plantSession(redis, userId, token, { epoch: 0 });
      await redis.incr(RedisKeys.sessionEpoch(userId));

      expect(await service.getUserSessions(userId)).toEqual([]);
      // Reaped, so it can never be counted as one of the MAX_SESSIONS either.
      expect(await redis.get(RedisKeys.session(sessionId))).toBeNull();
      expect(await redis.smembers(RedisKeys.userSessions(userId))).toEqual([]);
    });
  });

  describe('getUserSessions', () => {
    it('returns metadata for active sessions', async () => {
      const { service } = await buildSubject();
      await service.createSession({ ...baseParams, rememberMe: false });
      const sessions = await service.getUserSessions('u-1');
      expect(sessions.length).toBe(1);
      expect(sessions[0]).toMatchObject({ ip: '1.2.3.4', userAgent: 'jest' });
    });

    it('returns [] when user has no sessions', async () => {
      const { service } = await buildSubject();
      expect(await service.getUserSessions('u-empty')).toEqual([]);
    });

    it('cleans up stale entries (in SET but Redis key expired) and returns []', async () => {
      const { service, redis } = await buildSubject();
      // Seed only the SET, no session blob, emulating an expired session.
      await redis.sadd(RedisKeys.userSessions('u-stale'), 'stale-id');
      const result = await service.getUserSessions('u-stale');
      expect(result).toEqual([]);
      expect(await redis.smembers(RedisKeys.userSessions('u-stale'))).not.toContain('stale-id');
    });
  });
});
