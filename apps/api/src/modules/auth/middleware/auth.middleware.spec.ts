import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AuthMiddleware } from './auth.middleware';
import { SessionService } from '../services/session.service';
import { TwoFactorEnrollmentReader } from '../services/two-factor-enrollment.reader';
import { requestContext } from '../../../common/context/request-context';

const buildSubject = async (nodeEnv = 'test') => {
  const session = { validateSession: jest.fn() };
  const config = {
    get: jest.fn((key: string) => (key === 'NODE_ENV' ? nodeEnv : undefined)),
  };
  // Default: enrollment is genuinely still required, so the enforcement-gate
  // tests below fire; the stale-flag test overrides it to false. The derivation
  // itself is unit-tested in two-factor-enrollment.reader.spec.ts.
  const reader = { isEnrollmentStillRequired: jest.fn().mockResolvedValue(true) };
  const module = await Test.createTestingModule({
    providers: [
      AuthMiddleware,
      { provide: SessionService, useValue: session },
      { provide: TwoFactorEnrollmentReader, useValue: reader },
      { provide: ConfigService, useValue: config },
    ],
  }).compile();
  return { service: module.get(AuthMiddleware), session, reader };
};

const buildOpts = (cookies: Record<string, string>, path = 'user.me') => {
  const next = jest.fn().mockResolvedValue('next-result');
  return {
    next,
    opts: {
      ctx: { req: { cookies }, res: {}, user: null, session: null },
      next,
      path,
      // Other tRPC fields the middleware does not touch: cast to unknown.
    } as unknown as Parameters<AuthMiddleware['use']>[0],
  };
};

/**
 * Invoke the middleware inside an ALS scope, the way the global
 * TrpcRequestContextMiddleware does for every procedure in production.
 *
 * Required for any call that gets far enough to write `userId`/`tenantId`:
 * AuthMiddleware treats a missing store as a wiring defect and throws.
 */
const useInScope = async (
  service: AuthMiddleware,
  opts: Parameters<AuthMiddleware['use']>[0],
): Promise<unknown> =>
  requestContext.run({ requestId: 'test-request' }, async () => service.use(opts));

const flaggedSession = {
  sessionId: 'sid',
  userId: 'u-1',
  email: 'e',
  role: 'USER',
  emailVerified: true,
  ip: '',
  userAgent: '',
  createdAt: 0,
  lastActive: 0,
  expiresAt: 0,
  tenantId: 'ten-1',
  twoFactorEnrollmentRequired: true as const,
};

describe('AuthMiddleware', () => {
  it('throws UNAUTHORIZED when no session_id cookie is present', async () => {
    const { service } = await buildSubject();
    const { opts } = buildOpts({});
    await expect(service.use(opts)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Not authenticated',
    });
  });

  it('throws UNAUTHORIZED with "Invalid or expired session" when validateSession returns null', async () => {
    const { service, session } = await buildSubject();
    session.validateSession.mockResolvedValue(null);
    const { opts } = buildOpts({ session_id: 'tok' });
    await expect(service.use(opts)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Invalid or expired session',
    });
  });

  it('happy path: passes session.user + session id/token into next() ctx', async () => {
    const { service, session } = await buildSubject();
    session.validateSession.mockResolvedValue({
      sessionId: 'sid',
      userId: 'u-1',
      email: 'e@x.com',
      role: 'USER',
      emailVerified: true,
      ip: '1',
      userAgent: 'ua',
      createdAt: 0,
      lastActive: 0,
      expiresAt: 0,
    });
    const { opts, next } = buildOpts({ session_id: 'tok' });

    await useInScope(service, opts);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx: expect.objectContaining({
          user: { id: 'u-1', email: 'e@x.com', role: 'USER', emailVerified: true },
          session: { id: 'sid', token: 'tok' },
        }),
      }),
    );
  });

  it('populates ALS userId when run inside requestContext.run', async () => {
    const { service, session } = await buildSubject();
    session.validateSession.mockResolvedValue({
      sessionId: 'sid',
      userId: 'u-1',
      email: 'e',
      role: 'USER',
      emailVerified: true,
      ip: '',
      userAgent: '',
      createdAt: 0,
      lastActive: 0,
      expiresAt: 0,
    });
    const { opts } = buildOpts({ session_id: 't' });

    await requestContext.run({ requestId: 'r' }, async () => {
      await service.use(opts);
      expect(requestContext.getStore()?.userId).toBe('u-1');
    });
  });

  it('fails closed when the ALS store is missing (scope middleware not wired)', async () => {
    const { service, session } = await buildSubject();
    session.validateSession.mockResolvedValue({
      sessionId: 'sid',
      userId: 'u-1',
      email: 'e',
      role: 'USER',
      emailVerified: true,
      ip: '',
      userAgent: '',
      createdAt: 0,
      lastActive: 0,
      expiresAt: 0,
    });
    const { opts } = buildOpts({ session_id: 't' });
    // Silently skipping the write would leave every tenant-scoped query to fail
    // closed later, pointing at Prisma instead of the scope that never opened.
    // Generic on the wire: tRPC copies a plain Error's message straight to the
    // client, so the diagnostic detail is logged rather than thrown.
    await expect(service.use(opts)).rejects.toThrow(/Request context unavailable/);
  });

  it('enforcement gate: a flagged session is refused on a non-allowlisted path', async () => {
    const { service, session } = await buildSubject();
    session.validateSession.mockResolvedValue(flaggedSession);
    const { opts } = buildOpts({ session_id: 'tok' }, 'user.updateProfile');
    await expect(service.use(opts)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Two-factor authentication setup is required',
    });
  });

  it('enforcement gate: a flagged session may still reach the enroll/logout allowlist', async () => {
    const { service, session } = await buildSubject();
    session.validateSession.mockResolvedValue(flaggedSession);
    for (const path of [
      'twoFactor.beginEnrollment',
      'twoFactor.activate',
      'twoFactor.status',
      'auth.logout',
      'auth.logoutAll',
    ]) {
      const { opts } = buildOpts({ session_id: 'tok' }, path);
      await expect(useInScope(service, opts)).resolves.toBe('next-result');
    }
  });

  it('re-derives against live state: the flagged session and its tenant are passed to the reader', async () => {
    const { service, session, reader } = await buildSubject();
    session.validateSession.mockResolvedValue(flaggedSession);
    const { opts } = buildOpts({ session_id: 'tok' }, 'user.updateProfile');
    await expect(service.use(opts)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(reader.isEnrollmentStillRequired).toHaveBeenCalledWith('u-1', 'ten-1');
  });

  it('stale flag: passes through when the reader reports enrollment is no longer required', async () => {
    const { service, session, reader } = await buildSubject();
    session.validateSession.mockResolvedValue(flaggedSession);
    reader.isEnrollmentStillRequired.mockResolvedValue(false);
    const { opts } = buildOpts({ session_id: 'tok' }, 'user.updateProfile');
    // No loop: the gate re-checks live state, sees the requirement is gone, allows.
    await expect(useInScope(service, opts)).resolves.toBe('next-result');
  });

  it('does not consult the reader for an unflagged session (hot path stays read-free)', async () => {
    const { service, session, reader } = await buildSubject();
    session.validateSession.mockResolvedValue({
      ...flaggedSession,
      twoFactorEnrollmentRequired: false,
    });
    const { opts } = buildOpts({ session_id: 'tok' }, 'user.updateProfile');
    await expect(useInScope(service, opts)).resolves.toBe('next-result');
    expect(reader.isEnrollmentStillRequired).not.toHaveBeenCalled();
  });

  it('production reads the __Host- prefixed cookie name (bare session_id is ignored)', async () => {
    const { service, session } = await buildSubject('production');
    session.validateSession.mockResolvedValue({
      sessionId: 'sid',
      userId: 'u-1',
      email: 'e',
      role: 'USER',
      emailVerified: true,
      ip: '',
      userAgent: '',
      createdAt: 0,
      lastActive: 0,
      expiresAt: 0,
    });

    // The bare dev name must not authenticate in production.
    const { opts: bareOpts } = buildOpts({ session_id: 't' });
    await expect(service.use(bareOpts)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    const { opts } = buildOpts({ '__Host-session_id': 't' });
    await expect(useInScope(service, opts)).resolves.toBe('next-result');
    expect(session.validateSession).toHaveBeenCalledWith('t');
  });
});
