import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AppErrorCode } from '@repo/shared/errors';
import { AuthSharedService } from './auth-shared.service';
import { SessionService } from './session.service';
import { TurnstileService } from './turnstile.service';
import { CsrfService } from '../../../common/security/csrf.service';
import { EventsService } from '../../events/events.service';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { buildRedisChainMock } from '@test/test-module';
import { expressMocks } from '@test/fixtures';

const buildSubject = async (nodeEnv: 'production' | 'development' | 'test') => {
  const turnstile = { validate: jest.fn() };
  const session = { createSession: jest.fn() };
  const csrf = { rotate: jest.fn() };
  const events = { disconnectSession: jest.fn() };
  const values: Record<string, string> = { NODE_ENV: nodeEnv, APP_URL: 'http://app' };
  const config = {
    get: jest.fn((k: string) => values[k]),
    getOrThrow: jest.fn((k: string) => {
      const v = values[k];
      if (v === undefined) throw new Error(`Missing config: ${k}`);
      return v;
    }),
  };
  const chain = buildRedisChainMock();
  const redis = { multi: jest.fn(() => chain) };
  /** Shape the limiter MULTI reply: [incr count, expire reply]. */
  const mockLimiterCount = (count: number) => {
    chain.exec.mockResolvedValue([
      [null, count],
      [null, 1],
    ]);
  };
  const module = await Test.createTestingModule({
    providers: [
      AuthSharedService,
      { provide: TurnstileService, useValue: turnstile },
      { provide: SessionService, useValue: session },
      { provide: CsrfService, useValue: csrf },
      { provide: EventsService, useValue: events },
      { provide: ConfigService, useValue: config },
      { provide: REDIS_CLIENT, useValue: redis },
    ],
  }).compile();
  return {
    service: module.get(AuthSharedService),
    turnstile,
    session,
    csrf,
    events,
    redis,
    chain,
    mockLimiterCount,
  };
};

describe('AuthSharedService', () => {
  describe('setSessionCookie', () => {
    it('production + desktop origin → __Host- prefixed name, secure: true, sameSite: "none"', async () => {
      const { service } = await buildSubject('production');
      const { req, res, cookieMock } = expressMocks({ headers: { origin: 'app://app' } });
      service.setSessionCookie(req, res, 't', 1000);
      // __Host- requires secure + path '/' + NO domain attribute; the options
      // object below satisfies all three (domain is simply never set). The
      // packaged Electron renderer is a cross-site app:// origin, so its
      // session cookie must be SameSite=None to be sent at all.
      expect(cookieMock).toHaveBeenCalledWith(
        '__Host-session_id',
        't',
        expect.objectContaining({
          httpOnly: true,
          secure: true,
          sameSite: 'none',
          path: '/',
          maxAge: 1000,
        }),
      );
    });

    it('production + web origin → sameSite: "lax" (SPA is same-origin behind the platform router)', async () => {
      const { service } = await buildSubject('production');
      const { req, res, cookieMock } = expressMocks({
        headers: { origin: 'https://app.example.com' },
      });
      service.setSessionCookie(req, res, 't', 1000);
      expect(cookieMock).toHaveBeenCalledWith(
        '__Host-session_id',
        't',
        expect.objectContaining({
          secure: true,
          sameSite: 'lax',
        }),
      );
    });

    it('production + no Origin header → sameSite: "lax" (only the exact desktop origin gets "none")', async () => {
      const { service } = await buildSubject('production');
      const { req, res, cookieMock } = expressMocks();
      service.setSessionCookie(req, res, 't', 1000);
      expect(cookieMock).toHaveBeenCalledWith(
        '__Host-session_id',
        't',
        expect.objectContaining({ sameSite: 'lax' }),
      );
    });

    it('development → secure: false, sameSite: "lax" even for the desktop origin', async () => {
      const { service } = await buildSubject('development');
      const { req, res, cookieMock } = expressMocks({ headers: { origin: 'app://app' } });
      service.setSessionCookie(req, res, 't', 1000);
      expect(cookieMock).toHaveBeenCalledWith(
        'session_id',
        't',
        expect.objectContaining({
          secure: false,
          sameSite: 'lax',
        }),
      );
    });
  });

  describe('clearSessionCookie', () => {
    it('zeroes maxAge, keeps the set name + path, and stays request-independent (sameSite "none" in prod)', async () => {
      const { service } = await buildSubject('production');
      const { res, cookieMock } = expressMocks();
      // Deletion matches on name + path only, so the clear takes no request
      // and always uses the env-deterministic sameSite.
      service.clearSessionCookie(res);
      expect(cookieMock).toHaveBeenCalledWith(
        '__Host-session_id',
        '',
        expect.objectContaining({
          maxAge: 0,
          secure: true,
          sameSite: 'none',
          path: '/',
        }),
      );
    });
  });

  describe('establishSession', () => {
    const params = {
      userId: 'u-1',
      email: 'user@example.com',
      role: 'USER',
      emailVerified: true,
      ip: '1.2.3.4',
      userAgent: 'ua',
      rememberMe: false,
    };

    it('creates the session, sets the cookie with the session-derived maxAge, and rotates CSRF', async () => {
      const { service, session, csrf } = await buildSubject('development');
      const { req, res, cookieMock } = expressMocks();
      const expiresAt = new Date(Date.now() + 60_000);
      session.createSession.mockResolvedValue({
        token: 'tok-1',
        expiresAt,
        evictedSessionIds: [],
      });

      const result = await service.establishSession(req, res, { ...params, tenantId: 't-1' });

      expect(session.createSession).toHaveBeenCalledWith({ ...params, tenantId: 't-1' });
      expect(cookieMock).toHaveBeenCalledWith(
        'session_id',
        'tok-1',
        expect.objectContaining({ maxAge: expect.any(Number) }),
      );
      const maxAge = (cookieMock.mock.calls[0]?.[2] as { maxAge: number }).maxAge;
      expect(maxAge).toBeGreaterThan(0);
      expect(maxAge).toBeLessThanOrEqual(60_000);
      expect(csrf.rotate).toHaveBeenCalledWith(req, res);
      expect(result).toEqual({ token: 'tok-1', expiresAt });
    });

    it('coerces a null tenantId to undefined so the session field stays absent', async () => {
      const { service, session } = await buildSubject('development');
      const { req, res } = expressMocks();
      session.createSession.mockResolvedValue({
        token: 't',
        expiresAt: new Date(),
        evictedSessionIds: [],
      });

      await service.establishSession(req, res, { ...params, tenantId: null });

      expect(session.createSession).toHaveBeenCalledWith({ ...params, tenantId: undefined });
    });

    it('closes the sockets of every session the max-sessions cap evicted', async () => {
      const { service, session, events } = await buildSubject('development');
      const { req, res } = expressMocks();
      session.createSession.mockResolvedValue({
        token: 'tok-1',
        expiresAt: new Date(Date.now() + 60_000),
        evictedSessionIds: ['sid-old-1', 'sid-old-2'],
      });

      await service.establishSession(req, res, params);

      // Per session, never user-wide: the surviving devices of the same person
      // must stay connected. SessionService cannot do this itself (it would be
      // a module cycle), so this is the nearest caller that can.
      expect(events.disconnectSession).toHaveBeenCalledWith('sid-old-1');
      expect(events.disconnectSession).toHaveBeenCalledWith('sid-old-2');
      expect(events.disconnectSession).toHaveBeenCalledTimes(2);
    });

    it('closes nothing when the mint evicted nothing', async () => {
      const { service, session, events } = await buildSubject('development');
      const { req, res } = expressMocks();
      session.createSession.mockResolvedValue({
        token: 'tok-1',
        expiresAt: new Date(Date.now() + 60_000),
        evictedSessionIds: [],
      });

      await service.establishSession(req, res, params);

      expect(events.disconnectSession).not.toHaveBeenCalled();
    });
  });

  describe('validateTurnstile', () => {
    it('resolves when turnstile.validate returns true', async () => {
      const { service, turnstile } = await buildSubject('test');
      turnstile.validate.mockResolvedValue(true);
      await expect(service.validateTurnstile('tok', '1.2.3.4')).resolves.toBeUndefined();
      expect(turnstile.validate).toHaveBeenCalledWith('tok', '1.2.3.4');
    });

    it('throws FORBIDDEN/TURNSTILE_FAILED when turnstile.validate returns false', async () => {
      const { service, turnstile } = await buildSubject('test');
      turnstile.validate.mockResolvedValue(false);
      await expect(service.validateTurnstile('tok')).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: AppErrorCode.TURNSTILE_FAILED,
      });
    });
  });

  describe('enforceAuthRateLimit', () => {
    it('runs INCR + EXPIRE NX in one MULTI (no crash window can strand a TTL-less counter)', async () => {
      const { service, redis, chain, mockLimiterCount } = await buildSubject('test');
      mockLimiterCount(1);
      await expect(service.enforceAuthRateLimit('login', '1.2.3.4')).resolves.toBeUndefined();
      expect(redis.multi).toHaveBeenCalledTimes(1);
      expect(chain.incr).toHaveBeenCalledWith('ratelimit:login:1.2.3.4');
      // NX: arm the window TTL only when the key has none; later hits in the
      // same window must never slide it.
      expect(chain.expire).toHaveBeenCalledWith('ratelimit:login:1.2.3.4', 60, 'NX');
      expect(chain.exec).toHaveBeenCalledTimes(1);
    });

    it('allows hits up to the limit', async () => {
      const { service, mockLimiterCount } = await buildSubject('test');
      mockLimiterCount(10);
      await expect(service.enforceAuthRateLimit('login', '1.2.3.4')).resolves.toBeUndefined();
    });

    it('throws RATE_LIMITED once the count exceeds the limit', async () => {
      const { service, mockLimiterCount } = await buildSubject('test');
      mockLimiterCount(11);
      await expect(service.enforceAuthRateLimit('login', '1.2.3.4')).rejects.toMatchObject({
        message: AppErrorCode.RATE_LIMITED,
      });
    });

    it('propagates an INCR error from the MULTI reply', async () => {
      const { service, chain } = await buildSubject('test');
      chain.exec.mockResolvedValue([
        [new Error('WRONGTYPE'), null],
        [null, 1],
      ]);
      await expect(service.enforceAuthRateLimit('login', '1.2.3.4')).rejects.toThrow('WRONGTYPE');
    });
  });

  describe('enforceRateLimit (generic fixed window)', () => {
    it('uses the supplied scope, limit and window', async () => {
      const { service, chain, mockLimiterCount } = await buildSubject('test');
      mockLimiterCount(3);
      await expect(
        service.enforceRateLimit('resend-verification:u-1', 3, 3600),
      ).resolves.toBeUndefined();
      expect(chain.incr).toHaveBeenCalledWith('ratelimit:resend-verification:u-1');
      expect(chain.expire).toHaveBeenCalledWith('ratelimit:resend-verification:u-1', 3600, 'NX');
    });

    it('throws RATE_LIMITED above the supplied limit', async () => {
      const { service, mockLimiterCount } = await buildSubject('test');
      mockLimiterCount(4);
      await expect(
        service.enforceRateLimit('resend-verification:u-1', 3, 3600),
      ).rejects.toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        message: AppErrorCode.RATE_LIMITED,
      });
    });
  });
});
