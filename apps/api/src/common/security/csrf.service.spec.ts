import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CsrfService } from './csrf.service';
import { expressMocks } from '@test/fixtures';
import { CSRF_HEADER } from '@repo/shared/constants';

const buildSubject = async (nodeEnv: 'production' | 'development' | 'test') => {
  const values: Record<string, string> = {
    NODE_ENV: nodeEnv,
    CSRF_SECRET: 'super-long-secret-for-csrf-tests-123456',
  };
  const config = {
    get: jest.fn((k: string) => values[k]),
    getOrThrow: jest.fn((k: string) => {
      const v = values[k];
      if (v === undefined) throw new Error(`Missing config: ${k}`);
      return v;
    }),
  };
  const module = await Test.createTestingModule({
    providers: [CsrfService, { provide: ConfigService, useValue: config }],
  }).compile();
  // CsrfService now initializes in its constructor (no onModuleInit), so the
  // service is ready as soon as the module resolves it.
  return module.get(CsrfService);
};

/**
 * Whether `token`, replayed with the cookie `issue` wrote, passes `protect` on a
 * POST from the same sid: the double-submit round trip a real client makes.
 */
const acceptsOnPost = (
  service: CsrfService,
  token: string,
  issuedCookie: [string, string],
): boolean => {
  const [cookieName, cookieValue] = issuedCookie;
  const next = jest.fn();
  const { req, res } = expressMocks({
    method: 'POST',
    cookies: { 'csrf-sid': 'sid-1', [cookieName]: cookieValue },
    headers: { [CSRF_HEADER]: token },
  });
  service.protect(req, res, next);
  return next.mock.calls.length === 1 && next.mock.calls[0].length === 0;
};

describe('CsrfService', () => {
  describe('protect', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('passes through GET without invoking the underlying validator', async () => {
      const service = await buildSubject('test');
      const next = jest.fn();
      const { req, res } = expressMocks({ method: 'GET' });
      service.protect(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('passes through HEAD without invoking the underlying validator', async () => {
      const service = await buildSubject('test');
      const next = jest.fn();
      const { req, res } = expressMocks({ method: 'HEAD' });
      service.protect(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('passes through OPTIONS without invoking the underlying validator', async () => {
      const service = await buildSubject('test');
      const next = jest.fn();
      const { req, res } = expressMocks({ method: 'OPTIONS' });
      service.protect(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('responds 403 with the standard error envelope when the token is invalid', async () => {
      const service = await buildSubject('test');
      const next = jest.fn();
      // POST with a sid but no x-csrf-token header/cookie -> doubleCsrfProtection
      // rejects via next(err). The wrapper must translate that to a 403 (not let
      // it fall through to a 500) so the client's 403-only self-heal can recover.
      const { req, res } = expressMocks({ method: 'POST', cookies: { 'csrf-sid': 'sid-1' } });
      service.protect(req, res, next);
      // The error response replaces next() -> the request never reaches the router.
      expect(next).not.toHaveBeenCalled();
      expect(res.status as jest.Mock).toHaveBeenCalledWith(403);
      expect(res.json as jest.Mock).toHaveBeenCalledWith({
        error: { message: expect.stringMatching(/csrf/i), code: 403 },
      });
    });
  });

  describe('ensureSessionIdentifier', () => {
    it('sets sid cookie with sameSite: strict when missing in dev', async () => {
      const service = await buildSubject('development');
      const next = jest.fn();
      const { req, res, cookieMock } = expressMocks({ cookies: {} });
      service.ensureSessionIdentifier(req, res, next);
      expect(cookieMock).toHaveBeenCalledWith(
        'csrf-sid',
        expect.stringMatching(/^[0-9a-f]{64}$/),
        expect.objectContaining({ sameSite: 'strict', httpOnly: true, path: '/', secure: false }),
      );
      // The middleware also injects the sid into req.cookies for the current hop.
      expect(req.cookies['csrf-sid']).toMatch(/^[0-9a-f]{64}$/);
      expect(next).toHaveBeenCalled();
    });

    it('uses __Host-csrf-sid cookie name in production', async () => {
      const service = await buildSubject('production');
      const next = jest.fn();
      const { req, res, cookieMock } = expressMocks();
      service.ensureSessionIdentifier(req, res, next);
      expect(cookieMock.mock.calls[0][0]).toBe('__Host-csrf-sid');
      expect(cookieMock.mock.calls[0][2]).toMatchObject({ secure: true });
    });

    it('no-op when sid is already present', async () => {
      const service = await buildSubject('development');
      const next = jest.fn();
      const { req, res, cookieMock } = expressMocks({ cookies: { 'csrf-sid': 'pre-existing' } });
      service.ensureSessionIdentifier(req, res, next);
      expect(cookieMock).not.toHaveBeenCalled();
      expect(req.cookies['csrf-sid']).toBe('pre-existing');
      expect(next).toHaveBeenCalled();
    });
  });

  describe('rotate', () => {
    it('returns a fresh token string and writes a new cookie', async () => {
      const service = await buildSubject('development');
      const { req, res, cookieMock } = expressMocks({ cookies: { 'csrf-sid': 'sid-1' } });
      const token = service.rotate(req, res);
      expect(cookieMock).toHaveBeenCalledTimes(1);
      expect(acceptsOnPost(service, token, cookieMock.mock.calls[0])).toBe(true);
    });
  });

  describe('generate', () => {
    it('returns a token string for the current sid', async () => {
      const service = await buildSubject('development');
      const { req, res, cookieMock } = expressMocks({ cookies: { 'csrf-sid': 'sid-1' } });
      const token = service.generate(req, res);
      expect(acceptsOnPost(service, token, cookieMock.mock.calls[0])).toBe(true);
      expect(acceptsOnPost(service, `${token}x`, cookieMock.mock.calls[0])).toBe(false);
    });
  });
});
