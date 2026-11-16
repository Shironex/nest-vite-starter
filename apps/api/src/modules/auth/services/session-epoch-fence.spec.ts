/**
 * Cross-service tests for the session-epoch fence.
 *
 * SessionService's own spec drives the Redis-level interleavings. This one
 * drives the window that actually matters in production and that a fence
 * implemented only inside `createSession` would leave wide open: everything
 * between "we read the credential that authenticates this login" and "we hand
 * the browser a session cookie". On the password path that gap is a full argon2
 * verify; on the 2FA path it is up to five minutes of challenge.
 *
 * So the services are wired REAL end to end (LoginService -> the 2FA seam ->
 * AuthSharedService -> SessionService -> ioredis-mock) and only the collaborators
 * outside that path are mocked. A revocation is fired midway through a login
 * that is parked inside `passwordService.verify`, which is exactly how a victim
 * changing their password races an attacker signing in with the old one.
 */
import RedisMock from 'ioredis-mock';
import type Redis from 'ioredis';
import { AppErrorCode } from '@repo/shared/errors';
import { createAuthTestModule } from '@test/test-module';
import { expressMocks, userFixture, userProfileFixture } from '@test/fixtures';
import { SessionService } from './session.service';
import { AuthSharedService } from './auth-shared.service';
import { TwoFactorChallengeService } from './two-factor-challenge.service';
import { LoginService } from './login.service';
import { PasswordChangeService } from './password-change.service';
import { getSessionCookieName, getTwoFactorPendingCookieName } from '../auth.constants';

const SESSION_COOKIE = getSessionCookieName(false);
const PENDING_COOKIE = getTwoFactorPendingCookieName(false);

const loginInput = {
  email: 'user@example.com',
  password: 'CorrectHorseBatteryStaple1!',
  rememberMe: false,
  turnstileToken: 'tok',
};

// ioredis-mock shares one keyspace across instances, so every test works on a
// user id nothing else has touched (the epoch counter only ever counts up).
let userSeq = 0;
const freshUser = (): string => `u-race-${++userSeq}`;

const buildCtx = async () => {
  const redis = new RedisMock() as unknown as Redis;
  const ctx = await createAuthTestModule({
    realRedisMock: redis,
    // Real, in dependency order. createAuthTestModule registers its mocks
    // first and NestJS resolves a duplicated token last-wins, so these
    // replace the mock of the same token while everything else stays mocked.
    providers: [
      SessionService,
      AuthSharedService,
      TwoFactorChallengeService,
      LoginService,
      PasswordChangeService,
    ],
  });
  const session = ctx.get(SessionService);
  // The seam's live account-state read: every account here is eligible, so
  // the only thing that can refuse a mint in this file is the epoch fence.
  ctx.mocks.prisma.client.user.findFirst.mockResolvedValue({
    lockedUntil: null,
    membershipEndedAt: null,
  });
  return {
    ...ctx,
    redis,
    session,
    login: ctx.get(LoginService),
    challenge: ctx.get(TwoFactorChallengeService),
    passwordChange: ctx.get(PasswordChangeService),
  };
};

/** A `passwordService.verify` the test can park a login inside. */
const parkedVerify = () => {
  let entered!: () => void;
  let release!: () => void;
  const entering = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const releasing = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    entering,
    release,
    impl: async () => {
      entered();
      await releasing;
      return true;
    },
  };
};

const sessionCookieToken = (cookieMock: jest.Mock): string | undefined =>
  cookieMock.mock.calls.find(([name]) => name === SESSION_COOKIE)?.[1] as string | undefined;

describe('session-epoch fence (cross-service)', () => {
  describe('password login vs a concurrent revocation', () => {
    it('a login parked in argon2 loses to a revocation that lands mid-verify', async () => {
      const { login, session, mocks } = await buildCtx();
      const { req, res, cookieMock } = expressMocks();
      const userId = freshUser();
      mocks.user.findCredentialByEmail.mockResolvedValue(userFixture({ id: userId }));
      const verify = parkedVerify();
      mocks.password.verify.mockImplementation(verify.impl);

      const pending = login.login(loginInput, '1.2.3.4', 'ua', req, res);
      // The login has read the credential row and is now burning the ~100 ms of
      // argon2 that a naive fence would leave unguarded.
      await verify.entering;
      // Meanwhile the account owner changes their password (or an admin forces
      // a logout): the state this login already read is now revoked.
      await session.deleteAllUserSessions(userId);
      verify.release();

      await expect(pending).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        appCode: AppErrorCode.SESSION_EXPIRED,
      });
      // Nothing was handed to the browser: no session cookie at all.
      expect(sessionCookieToken(cookieMock)).toBeUndefined();
    });

    it('leaves no session behind for the revoked login', async () => {
      const { login, session, mocks, redis } = await buildCtx();
      const { req, res } = expressMocks();
      const userId = freshUser();
      mocks.user.findCredentialByEmail.mockResolvedValue(userFixture({ id: userId }));
      const verify = parkedVerify();
      mocks.password.verify.mockImplementation(verify.impl);

      const pending = login.login(loginInput, '1.2.3.4', 'ua', req, res);
      await verify.entering;
      await session.deleteAllUserSessions(userId);
      verify.release();
      await expect(pending).rejects.toThrow();

      // Not just cookie-less: the blob was rolled back, so it cannot linger as
      // a phantom "active session" nor evict a real one at MAX_SESSIONS.
      expect(await session.getUserSessions(userId)).toEqual([]);
      expect(await redis.smembers(`user_sessions:${userId}`)).toEqual([]);
    });

    it('the same login succeeds when the revocation finished before it started', async () => {
      const { login, session, mocks } = await buildCtx();
      const { req, res, cookieMock } = expressMocks();
      const userId = freshUser();
      mocks.user.findCredentialByEmail.mockResolvedValue(
        userFixture({ id: userId, emailVerified: true }),
      );
      mocks.user.getProfile.mockResolvedValue(userProfileFixture({ id: userId }));
      mocks.password.verify.mockResolvedValue(true);
      // The revocation is over and done with before this login reads anything.
      await session.deleteAllUserSessions(userId);

      const result = await login.login(loginInput, '1.2.3.4', 'ua', req, res);

      // The fence rejects staleness, not logins: a sign-in that read the
      // post-revocation world gets a session that works.
      expect(result.status).toBe('ok');
      const token = sessionCookieToken(cookieMock);
      expect(token).toBeDefined();
      expect(await session.validateSession(token!)).toMatchObject({ userId });
    });
  });

  describe('2FA challenge vs a concurrent revocation', () => {
    it('a revocation during the challenge kills the verify that would have minted the session', async () => {
      const { login, challenge, session, mocks } = await buildCtx();
      const userId = freshUser();
      mocks.user.findCredentialByEmail.mockResolvedValue(
        userFixture({ id: userId, emailVerified: true }),
      );
      mocks.password.verify.mockResolvedValue(true);
      // The account has TOTP, so the password step mints a pending record
      // instead of a session.
      mocks.secondFactor.findActiveNonRecovery.mockResolvedValue({ id: 'sf-1' });
      mocks.secondFactor.findActiveTotp.mockResolvedValue({ id: 'sf-1', totpSecretEnc: 'enc' });
      mocks.totp.verify.mockResolvedValue(true);
      mocks.user.findById.mockResolvedValue(userFixture({ id: userId, emailVerified: true }));

      const { req, res, cookieMock } = expressMocks();
      const first = await login.login(loginInput, '1.2.3.4', 'ua', req, res);
      expect(first.status).toBe('twofa_required');
      const pendingToken = cookieMock.mock.calls.find(
        ([name]) => name === PENDING_COOKIE,
      )?.[1] as string;

      // The password that authorized this pending record is changed while the
      // user is still reading their authenticator app.
      await session.deleteAllUserSessions(userId);

      const verifyMocks = expressMocks({ cookies: { [PENDING_COOKIE]: pendingToken } });
      await expect(
        challenge.verifyChallenge(
          verifyMocks.req,
          verifyMocks.res,
          { code: '123456' },
          '1.2.3.4',
          'ua',
        ),
      ).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        appCode: AppErrorCode.SESSION_EXPIRED,
      });
      // A correct TOTP code was submitted and still no session exists: the
      // pending record is not a session, but the session it mints must not
      // predate the revocation.
      expect(sessionCookieToken(verifyMocks.cookieMock)).toBeUndefined();
      expect(await session.getUserSessions(userId)).toEqual([]);
    });
  });

  describe('flows that revoke and then re-issue', () => {
    it('password change hands the caller a session that survives its own revocation', async () => {
      const { passwordChange, session, mocks } = await buildCtx();
      const { req, res, cookieMock } = expressMocks();
      const userId = freshUser();
      mocks.user.findCredentialById.mockResolvedValue(
        userFixture({ id: userId, emailVerified: true }),
      );
      mocks.password.verify.mockResolvedValue(true);
      mocks.password.hash.mockResolvedValue('new-hash');

      await passwordChange.changePassword(
        userId,
        'oldPw',
        'NewStrongPw1!',
        '1.2.3.4',
        'ua',
        req,
        res,
      );

      // The replacement session is minted AFTER the bump, so it must not fence
      // itself out, the regression an eagerly-captured epoch would cause.
      const token = sessionCookieToken(cookieMock);
      expect(token).toBeDefined();
      expect(await session.validateSession(token!)).toMatchObject({ userId });
    });
  });
});
