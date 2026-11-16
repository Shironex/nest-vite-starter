import { createHash } from 'node:crypto';
import { sha256Hex } from '../../../common/utils/crypto';
import { createAuthTestModule } from '@test/test-module';
import { expressMocks } from '@test/fixtures';
import { OAuthFlowService, sanitizeReturnTo } from './oauth-flow.service';
import {
  OAUTH_DEFAULT_RETURN_TO,
  OAUTH_LINK_RETURN_TO,
  OAUTH_STATE_KEY_PREFIX,
  OAUTH_STATE_TTL_SECONDS,
} from './oauth.constants';

describe('OAuthFlowService', () => {
  const buildCtx = async () => {
    const ctx = await createAuthTestModule({ providers: [OAuthFlowService] });
    return { ...ctx, service: ctx.get(OAuthFlowService) };
  };

  describe('sanitizeReturnTo()', () => {
    it('accepts a plain relative path (with query) unchanged', () => {
      expect(sanitizeReturnTo('/settings')).toBe('/settings');
      expect(sanitizeReturnTo('/settings/members?page=2')).toBe('/settings/members?page=2');
    });

    it.each([
      [undefined, 'absent'],
      ['', 'empty'],
      ['dashboard', 'no leading slash'],
      ['https://evil.example', 'absolute URL'],
      ['//evil.example', 'scheme-relative escape'],
      ['/\\evil.example', 'backslash normalization escape'],
      ['/a b', 'raw whitespace'],
      ['/a\nb', 'raw newline (header splitting)'],
      ['javascript:alert(1)', 'javascript scheme'],
    ])('falls back to the dashboard for %p (%s)', (raw: string | undefined, _label: string) => {
      expect(sanitizeReturnTo(raw as string | undefined)).toBe(OAUTH_DEFAULT_RETURN_TO);
    });
  });

  describe('issue()', () => {
    it('stores the blob under sha256(state), never the raw state, with the flow TTL', async () => {
      const { service, mocks } = await buildCtx();
      const { req, res } = expressMocks();

      const issued = await service.issue(req, res, { intent: 'login', returnTo: '/dashboard' });

      expect(mocks.redis.setex).toHaveBeenCalledTimes(1);
      const [key, ttl, rawBlob] = mocks.redis.setex.mock.calls[0] as [string, number, string];
      expect(key).toBe(`${OAUTH_STATE_KEY_PREFIX}:${sha256Hex(issued.state)}`);
      expect(key).not.toContain(issued.state);
      expect(ttl).toBe(OAUTH_STATE_TTL_SECONDS);
      const blob = JSON.parse(rawBlob) as Record<string, unknown>;
      // The whole record, so a field added to it is a deliberate test change.
      // The bind value itself never touches Redis; only its hash does, and a
      // login flow carries no pinned userId.
      expect(blob).toEqual({
        nonce: issued.nonce,
        codeVerifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        intent: 'login',
        returnTo: '/dashboard',
        browserBindHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      expect(blob).not.toHaveProperty('userId');
    });

    it('returns an S256 challenge derived from the stored verifier (PKCE)', async () => {
      const { service, mocks } = await buildCtx();
      const { req, res } = expressMocks();

      const issued = await service.issue(req, res, { intent: 'login', returnTo: undefined });

      const blob = JSON.parse(mocks.redis.setex.mock.calls[0][2] as string) as {
        codeVerifier: string;
      };
      const expected = createHash('sha256').update(blob.codeVerifier).digest('base64url');
      expect(issued.codeChallenge).toBe(expected);
    });

    it('sets the browser-bind cookie via the hardened shared path, hash matching the blob', async () => {
      const { service, mocks } = await buildCtx();
      const { req, res } = expressMocks();

      await service.issue(req, res, { intent: 'login', returnTo: undefined });

      expect(mocks.shared.setAuthCookie).toHaveBeenCalledTimes(1);
      const [, , cookieName, bindValue, maxAge] = mocks.shared.setAuthCookie.mock.calls[0] as [
        unknown,
        unknown,
        string,
        string,
        number,
      ];
      expect(cookieName).toBe('oauth_flow');
      expect(maxAge).toBe(OAUTH_STATE_TTL_SECONDS * 1000);
      const blob = JSON.parse(mocks.redis.setex.mock.calls[0][2] as string) as {
        browserBindHash: string;
      };
      expect(sha256Hex(bindValue)).toBe(blob.browserBindHash);
    });

    it('pins a link flow to the session user and forces the settings returnTo', async () => {
      const { service, mocks } = await buildCtx();
      const { req, res } = expressMocks();

      await service.issue(req, res, { intent: 'link', returnTo: '/anywhere', userId: 'u-1' });

      const blob = JSON.parse(mocks.redis.setex.mock.calls[0][2] as string) as Record<
        string,
        unknown
      >;
      expect(blob).toMatchObject({
        intent: 'link',
        userId: 'u-1',
        returnTo: OAUTH_LINK_RETURN_TO,
      });
    });

    it('mints unpredictable, unique state and nonce per flow', async () => {
      const { service } = await buildCtx();
      const { req, res } = expressMocks();

      const first = await service.issue(req, res, { intent: 'login', returnTo: undefined });
      const second = await service.issue(req, res, { intent: 'login', returnTo: undefined });

      // 32 random bytes hex-encoded.
      expect(first.state).toMatch(/^[0-9a-f]{64}$/);
      expect(first.nonce).toMatch(/^[0-9a-f]{64}$/);
      expect(second.state).not.toBe(first.state);
      expect(second.nonce).not.toBe(first.nonce);
    });
  });

  describe('consume()', () => {
    const storedFlow = (browserBind: string) => ({
      nonce: 'n',
      codeVerifier: 'v',
      returnTo: '/dashboard',
      intent: 'login',
      browserBindHash: sha256Hex(browserBind),
    });

    it('consumes via GETDEL (strictly one-time) and returns the blob when the cookie matches', async () => {
      const { service, mocks } = await buildCtx();
      mocks.redis.getdel.mockResolvedValue(JSON.stringify(storedFlow('bind-value')));
      const { req } = expressMocks({ cookies: { oauth_flow: 'bind-value' } });

      const result = await service.consume('the-state', req);

      expect(mocks.redis.getdel).toHaveBeenCalledWith(
        `${OAUTH_STATE_KEY_PREFIX}:${sha256Hex('the-state')}`,
      );
      // GETDEL, never GET: a replayed callback must find nothing.
      expect(mocks.redis.get).not.toHaveBeenCalled();
      expect(result).toEqual({
        outcome: 'ok',
        flow: expect.objectContaining({ intent: 'login', returnTo: '/dashboard' }),
      });
    });

    it('reports missing when the record is gone (expired or already consumed)', async () => {
      const { service, mocks } = await buildCtx();
      mocks.redis.getdel.mockResolvedValue(null);
      const { req } = expressMocks({ cookies: { oauth_flow: 'bind-value' } });

      expect(await service.consume('s', req)).toEqual({ outcome: 'missing' });
    });

    it('treats a corrupt blob as missing (fail closed)', async () => {
      const { service, mocks } = await buildCtx();
      mocks.redis.getdel.mockResolvedValue('{not json');
      const { req } = expressMocks({ cookies: { oauth_flow: 'bind-value' } });

      expect(await service.consume('s', req)).toEqual({ outcome: 'missing' });
    });

    it('rejects a callback from a browser without the bind cookie (login CSRF)', async () => {
      const { service, mocks } = await buildCtx();
      mocks.redis.getdel.mockResolvedValue(JSON.stringify(storedFlow('bind-value')));
      const { req } = expressMocks();

      expect(await service.consume('s', req)).toEqual({ outcome: 'browser_mismatch' });
    });

    it('rejects a wrong bind cookie AND has already burned the state', async () => {
      const { service, mocks } = await buildCtx();
      mocks.redis.getdel.mockResolvedValue(JSON.stringify(storedFlow('bind-value')));
      const { req } = expressMocks({ cookies: { oauth_flow: 'attacker-value' } });

      const result = await service.consume('s', req);

      expect(result).toEqual({ outcome: 'browser_mismatch' });
      // The GETDEL above destroyed the record: the mismatch cannot be retried.
      expect(mocks.redis.getdel).toHaveBeenCalledTimes(1);
    });
  });

  describe('clearFlowCookie()', () => {
    it('clears through the shared hardened path', async () => {
      const { service, mocks } = await buildCtx();
      const { res } = expressMocks();

      service.clearFlowCookie(res);

      expect(mocks.shared.clearAuthCookie).toHaveBeenCalledWith(res, 'oauth_flow');
    });
  });
});
