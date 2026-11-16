import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';

// The controller's only ops signal for an OAuth outage. Kept inspectable so the
// specs below can assert what it may and may not say about the error object.
const loggerWarnMock = jest.fn();
jest.mock('../../logger/logger.service', () => ({
  createAppLogger: () => ({
    error: jest.fn(),
    warn: (...args: unknown[]) => loggerWarnMock(...args),
    info: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(),
  }),
}));

const captureMessageMock = jest.fn();
jest.mock('@sentry/nestjs', () => ({
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
}));

import { createAuthTestModule } from '@test/test-module';
import { expressMocks } from '@test/fixtures';
import { OAuthController } from './oauth.controller';
import {
  OAUTH_CALLBACK_ROUTE,
  OAUTH_CONTROLLER_PATH,
  OAUTH_PROVIDERS_ROUTE,
  OAUTH_START_ROUTE,
} from './oauth.constants';
import { SudoService } from '../services/sudo.service';
import { OAuthAccountService } from './oauth-account.service';
import { OAuthFlowService } from './oauth-flow.service';
import type { IOAuthProvider } from './providers/oauth-provider.interface';
import { ProviderRegistryService } from './providers/provider-registry.service';

const API_PUBLIC_URL = 'https://api.example.com';
const APP_URL = 'http://localhost:3000';

const providerFixture = (key = 'google'): jest.Mocked<IOAuthProvider> => ({
  key,
  isEnabled: true,
  buildAuthorizationUrl: jest
    .fn()
    .mockResolvedValue(new URL('https://accounts.google.com/o/oauth2/v2/auth?client_id=x')),
  handleCallback: jest.fn(),
});

const identityFixture = () => ({
  provider: 'google',
  subject: 'sub-123',
  email: 'user@example.com',
  emailVerified: true,
});

describe('OAuthController', () => {
  const buildSubject = async (providers: readonly IOAuthProvider[] = [providerFixture()]) => {
    const registry = {
      get: jest.fn((key: string) => providers.find((p) => p.key === key && p.isEnabled)),
      getEnabled: jest.fn(() => providers.filter((p) => p.isEnabled)),
    };
    const flow = {
      issue: jest.fn().mockResolvedValue({ state: 'st', nonce: 'no', codeChallenge: 'ch' }),
      consume: jest.fn(),
      clearFlowCookie: jest.fn(),
    };
    const account = {
      resolveLogin: jest.fn(),
      completeLink: jest.fn(),
      auditFailure: jest.fn().mockResolvedValue(undefined),
    };
    const sudo = {
      isActive: jest.fn().mockResolvedValue(false),
    };
    const ctx = await createAuthTestModule({
      configDefaults: { API_PUBLIC_URL },
      providers: [
        { provide: ProviderRegistryService, useValue: registry },
        { provide: OAuthFlowService, useValue: flow },
        { provide: OAuthAccountService, useValue: account },
        { provide: SudoService, useValue: sudo },
        OAuthController,
      ],
    });
    return {
      ...ctx,
      registry,
      flow,
      account,
      sudo,
      controller: ctx.get(OAuthController),
    };
  };

  /** A logged-in browser: session cookie present and validating to `sess-1` / `u-1`. */
  const withSession = (mocks: { session: { validateSession: jest.Mock } }) => {
    mocks.session.validateSession.mockResolvedValue({
      sessionId: 'sess-1',
      userId: 'u-1',
      email: 'e@x.io',
      role: 'USER',
      emailVerified: true,
      epoch: 0,
    });
    return { cookies: { session_id: 'raw-session-token' } };
  };

  const expectErrorRedirect = (redirectMock: jest.Mock, code: string) => {
    expect(redirectMock).toHaveBeenCalledWith(302, `${APP_URL}/auth?error=${code}`);
  };

  /**
   * One structured line and one Sentry message per failure, carrying the shape
   * of the error and nothing else: openid-client embeds the authorization URL
   * (with the state) or the token request (with the code) in its messages.
   */
  const expectFailureReported = (stage: string, error: string) => {
    expect(loggerWarnMock).toHaveBeenCalledWith(
      'OAuth flow failed',
      expect.objectContaining({ op: `oauth.${stage}`, provider: 'google', error }),
    );
    expect(captureMessageMock).toHaveBeenCalledWith(
      'OAuth flow failed',
      expect.objectContaining({
        level: 'warning',
        tags: expect.objectContaining({ op: `oauth.${stage}`, provider: 'google' }),
      }),
    );
  };

  beforeEach(() => {
    loggerWarnMock.mockClear();
    captureMessageMock.mockClear();
  });

  describe('route wiring', () => {
    it('mounts the three routes under /api/auth/oauth', () => {
      const controllerPath = Reflect.getMetadata('path', OAuthController) as string;
      expect(controllerPath).toBe(OAUTH_CONTROLLER_PATH);
      expect(Reflect.getMetadata('path', OAuthController.prototype.listProviders)).toBe(
        OAUTH_PROVIDERS_ROUTE,
      );
      expect(Reflect.getMetadata('path', OAuthController.prototype.start)).toBe(OAUTH_START_ROUTE);
      expect(Reflect.getMetadata('path', OAuthController.prototype.callback)).toBe(
        OAUTH_CALLBACK_ROUTE,
      );
      expect(`/${controllerPath}/${OAUTH_PROVIDERS_ROUTE}`).toBe('/api/auth/oauth/providers');
    });
  });

  describe('listProviders()', () => {
    it('returns exactly { providers: [{ key }] } for the enabled providers', async () => {
      // Pinned discovery contract: key only. Label, icon and every word of
      // branding are owned by the web, so adding a field here is a wire break.
      const { controller } = await buildSubject([providerFixture('google')]);
      expect(controller.listProviders()).toStrictEqual({ providers: [{ key: 'google' }] });
    });

    it('returns an empty array, never a missing key, when nothing is enabled', async () => {
      const { controller } = await buildSubject([]);
      expect(controller.listProviders()).toStrictEqual({ providers: [] });
    });

    it('preserves registry order and exposes no other provider internals', async () => {
      const { controller } = await buildSubject([
        providerFixture('google'),
        providerFixture('apple'),
      ]);
      expect(controller.listProviders()).toStrictEqual({
        providers: [{ key: 'google' }, { key: 'apple' }],
      });
    });
  });

  describe('start()', () => {
    it('404s an unknown or disabled provider before any redirect is built', async () => {
      const { controller, flow } = await buildSubject([]);
      const { req, res } = expressMocks();

      await expect(
        controller.start('google', undefined, undefined, req, res),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(flow.issue).not.toHaveBeenCalled();
    });

    it('mints the flow and 302s to the provider URL, redirect_uri from API_PUBLIC_URL not Host', async () => {
      const provider = providerFixture();
      const { controller, flow } = await buildSubject([provider]);
      // A forged Host header must never reach the redirect_uri.
      const { req, res, redirectMock } = expressMocks({ headers: { host: 'evil.example' } });

      await controller.start('google', '/settings', undefined, req, res);

      expect(flow.issue).toHaveBeenCalledWith(req, res, { intent: 'login', returnTo: '/settings' });
      expect(provider.buildAuthorizationUrl).toHaveBeenCalledWith({
        redirectUri: `${API_PUBLIC_URL}/api/auth/oauth/google/callback`,
        state: 'st',
        nonce: 'no',
        codeChallenge: 'ch',
      });
      expect(redirectMock).toHaveBeenCalledWith(
        302,
        'https://accounts.google.com/o/oauth2/v2/auth?client_id=x',
      );
    });

    it('redirects (never JSON) and audits when the per-IP window is exhausted', async () => {
      const { controller, flow, account, mocks } = await buildSubject();
      mocks.shared.enforceRateLimit.mockRejectedValue(new Error('rate limited'));
      const { req, res, redirectMock } = expressMocks();

      await controller.start('google', undefined, undefined, req, res);

      expect(flow.issue).not.toHaveBeenCalled();
      expect(account.auditFailure).toHaveBeenCalledWith(
        { provider: 'google' },
        'rate_limited',
        expect.anything(),
      );
      expectErrorRedirect(redirectMock, 'oauth_failed');
    });

    it('refuses a link-intent start with NO session: no flow minted, generic redirect', async () => {
      const { controller, flow, account, mocks } = await buildSubject();
      const { req, res, redirectMock } = expressMocks();

      await controller.start('google', undefined, 'link', req, res);

      // No session cookie: validateSession is never even reached.
      expect(mocks.session.validateSession).not.toHaveBeenCalled();
      expect(flow.issue).not.toHaveBeenCalled();
      expect(account.auditFailure).toHaveBeenCalledWith(
        { provider: 'google' },
        'link_unauthorized',
        expect.anything(),
      );
      expectErrorRedirect(redirectMock, 'oauth_failed');
    });

    it('refuses a link-intent start with a session but NO live sudo grant', async () => {
      const { controller, flow, account, sudo, mocks } = await buildSubject();
      const init = withSession(mocks);
      sudo.isActive.mockResolvedValue(false);
      const { req, res, redirectMock } = expressMocks(init);

      await controller.start('google', undefined, 'link', req, res);

      expect(sudo.isActive).toHaveBeenCalledWith('sess-1');
      expect(flow.issue).not.toHaveBeenCalled();
      expect(account.auditFailure).toHaveBeenCalledWith(
        { provider: 'google' },
        'link_unauthorized',
        expect.anything(),
      );
      expectErrorRedirect(redirectMock, 'oauth_failed');
    });

    it('starts a link flow for a sudo-elevated session, pinning the flow to that user', async () => {
      const provider = providerFixture();
      const { controller, flow, sudo, mocks } = await buildSubject([provider]);
      const init = withSession(mocks);
      sudo.isActive.mockResolvedValue(true);
      const { req, res, redirectMock } = expressMocks(init);

      await controller.start('google', undefined, 'link', req, res);

      expect(flow.issue).toHaveBeenCalledWith(req, res, {
        intent: 'link',
        returnTo: undefined,
        userId: 'u-1',
      });
      expect(redirectMock).toHaveBeenCalledWith(
        302,
        'https://accounts.google.com/o/oauth2/v2/auth?client_id=x',
      );
    });

    it('audits and redirects generically when discovery/authorization-url building throws', async () => {
      const provider = providerFixture();
      provider.buildAuthorizationUrl.mockRejectedValue(new Error('discovery down'));
      const { controller, account } = await buildSubject([provider]);
      const { req, res, redirectMock } = expressMocks();

      await controller.start('google', undefined, undefined, req, res);

      expect(account.auditFailure).toHaveBeenCalledWith(
        { provider: 'google' },
        'exception',
        expect.anything(),
      );
      expectErrorRedirect(redirectMock, 'oauth_failed');
      expectFailureReported('authorize', 'Error');
    });

    it('reports the failure shape without the error message or the authorization url', async () => {
      const provider = providerFixture();
      // What openid-client actually throws: the request it was making, state
      // included, inside the message.
      provider.buildAuthorizationUrl.mockRejectedValue(
        Object.assign(
          new Error('failed to fetch https://accounts.google.com/authorize?state=SECRETSTATE'),
          { code: 'OAUTH_DISCOVERY_ERROR' },
        ),
      );
      const { controller } = await buildSubject([provider]);
      const { req, res } = expressMocks();

      await controller.start('google', undefined, undefined, req, res);

      const [, details] = loggerWarnMock.mock.calls[0] as [string, Record<string, unknown>];
      expect(details).toEqual({
        op: 'oauth.authorize',
        provider: 'google',
        error: 'Error',
        code: 'OAUTH_DISCOVERY_ERROR',
      });
      const reported = JSON.stringify([loggerWarnMock.mock.calls, captureMessageMock.mock.calls]);
      expect(reported).not.toContain('SECRETSTATE');
      expect(reported).not.toContain('accounts.google.com');
    });
  });

  describe('callback()', () => {
    const loginFlow = {
      nonce: 'the-nonce',
      codeVerifier: 'the-verifier',
      returnTo: '/dashboard',
      intent: 'login' as const,
      browserBindHash: 'h',
    };

    it('404s an unknown provider', async () => {
      const { controller } = await buildSubject([]);
      const { req, res } = expressMocks();

      await expect(controller.callback('google', req, res)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('redirects oauth_state_expired (cookie cleared) when the state param is missing', async () => {
      const { controller, flow, account } = await buildSubject();
      const { req, res, redirectMock } = expressMocks({ query: {} });

      await controller.callback('google', req, res);

      expect(flow.clearFlowCookie).toHaveBeenCalledWith(res);
      expect(account.auditFailure).toHaveBeenCalledWith(
        { provider: 'google' },
        'state_missing',
        expect.anything(),
      );
      expectErrorRedirect(redirectMock, 'oauth_state_expired');
    });

    it.each([['missing'], ['browser_mismatch']])(
      'redirects oauth_state_expired and audits %s when consume rejects the flow',
      async (outcome) => {
        const provider = providerFixture();
        const { controller, flow, account } = await buildSubject([provider]);
        flow.consume.mockResolvedValue({ outcome });
        const { req, res, redirectMock } = expressMocks({ query: { state: 's', code: 'c' } });

        await controller.callback('google', req, res);

        expect(flow.consume).toHaveBeenCalledWith('s', req);
        expect(flow.clearFlowCookie).toHaveBeenCalledWith(res);
        expect(account.auditFailure).toHaveBeenCalledWith(
          { provider: 'google' },
          outcome,
          expect.anything(),
        );
        expectErrorRedirect(redirectMock, 'oauth_state_expired');
        expect(provider.handleCallback).not.toHaveBeenCalled();
      },
    );

    it('burns the state FIRST, then reports a provider error param as oauth_failed', async () => {
      const provider = providerFixture();
      const { controller, flow, account } = await buildSubject([provider]);
      flow.consume.mockResolvedValue({ outcome: 'ok', flow: loginFlow });
      const { req, res, redirectMock } = expressMocks({
        query: { state: 's', error: 'access_denied' },
      });

      await controller.callback('google', req, res);

      expect(flow.consume).toHaveBeenCalledWith('s', req);
      expect(account.auditFailure).toHaveBeenCalledWith(
        { provider: 'google' },
        'provider_denied',
        expect.anything(),
      );
      expectErrorRedirect(redirectMock, 'oauth_failed');
      expect(provider.handleCallback).not.toHaveBeenCalled();
    });

    it('maps any exchange/verification failure to the one generic bucket, no lockout, no seam call', async () => {
      const provider = providerFixture();
      provider.handleCallback.mockRejectedValue(new Error('nonce mismatch'));
      const { controller, flow, account, mocks } = await buildSubject([provider]);
      flow.consume.mockResolvedValue({ outcome: 'ok', flow: loginFlow });
      const { req, res, redirectMock } = expressMocks({ query: { state: 's', code: 'c' } });

      await controller.callback('google', req, res);

      expect(account.auditFailure).toHaveBeenCalledWith(
        { provider: 'google' },
        'exchange_failed',
        expect.anything(),
      );
      expectErrorRedirect(redirectMock, 'oauth_failed');
      expectFailureReported('exchange', 'Error');
      expect(mocks.twoFactorChallenge.beginOrEstablish).not.toHaveBeenCalled();
      // OAuth failures are never password guesses.
      expect(mocks.lockout.recordFailedAttempt).not.toHaveBeenCalled();
    });

    it('rebuilds the callback URL from API_PUBLIC_URL, never the Host header', async () => {
      const provider = providerFixture();
      provider.handleCallback.mockResolvedValue(identityFixture());
      const { controller, flow, account } = await buildSubject([provider]);
      flow.consume.mockResolvedValue({ outcome: 'ok', flow: loginFlow });
      account.resolveLogin.mockResolvedValue({
        outcome: 'authenticated',
        user: { id: 'u-1', email: 'e', role: 'USER', emailVerified: true, tenantId: 't-1' },
        epoch: 2,
      });
      const { req, res } = expressMocks({
        headers: { host: 'evil.example' },
        query: { state: 'the-state', code: 'the-code' },
        originalUrl: '/api/auth/oauth/google/callback?code=the-code&state=the-state',
      });

      await controller.callback('google', req, res);

      expect(provider.handleCallback).toHaveBeenCalledWith({
        currentUrl: new URL(
          `${API_PUBLIC_URL}/api/auth/oauth/google/callback?code=the-code&state=the-state`,
        ),
        redirectUri: `${API_PUBLIC_URL}/api/auth/oauth/google/callback`,
        expectedState: 'the-state',
        expectedNonce: 'the-nonce',
        codeVerifier: 'the-verifier',
      });
    });

    it('login success goes THROUGH the 2FA seam with rememberMe false and the captured epoch', async () => {
      const provider = providerFixture();
      provider.handleCallback.mockResolvedValue(identityFixture());
      const { controller, flow, account, mocks } = await buildSubject([provider]);
      flow.consume.mockResolvedValue({ outcome: 'ok', flow: loginFlow });
      const user = { id: 'u-1', email: 'e', role: 'USER', emailVerified: true, tenantId: 't-1' };
      account.resolveLogin.mockResolvedValue({ outcome: 'authenticated', user, epoch: 5 });
      const { req, res, redirectMock } = expressMocks({ query: { state: 's', code: 'c' } });

      await controller.callback('google', req, res);

      expect(mocks.twoFactorChallenge.beginOrEstablish).toHaveBeenCalledWith(req, res, user, {
        rememberMe: false,
        ip: expect.any(String),
        userAgent: expect.any(String),
        epoch: 5,
      });
      // The seam is the ONLY door: no direct establishSession from the callback.
      expect(mocks.shared.establishSession).not.toHaveBeenCalled();
      expect(redirectMock).toHaveBeenCalledWith(302, `${APP_URL}/dashboard`);
    });

    it.each([['@evil.example/x'], ['//evil.example/x']])(
      'never redirects off the app origin when the stored returnTo is %p',
      async (returnTo) => {
        // The Redis record is sanitized when issued; this pins the second check
        // at the redirect itself, so a record that reached Redis some other way
        // cannot turn APP_URL into userinfo or a scheme-relative escape.
        const provider = providerFixture();
        provider.handleCallback.mockResolvedValue(identityFixture());
        const { controller, flow, account } = await buildSubject([provider]);
        flow.consume.mockResolvedValue({ outcome: 'ok', flow: { ...loginFlow, returnTo } });
        const user = { id: 'u-1', email: 'e', role: 'USER', emailVerified: true, tenantId: 't-1' };
        account.resolveLogin.mockResolvedValue({ outcome: 'authenticated', user, epoch: 5 });
        const { req, res, redirectMock } = expressMocks({ query: { state: 's', code: 'c' } });

        await controller.callback('google', req, res);

        expect(redirectMock).toHaveBeenCalledWith(302, `${APP_URL}/dashboard`);
      },
    );

    it('redirects to the SPA challenge route when the seam returns a challenge', async () => {
      const provider = providerFixture();
      provider.handleCallback.mockResolvedValue(identityFixture());
      const { controller, flow, account, mocks } = await buildSubject([provider]);
      flow.consume.mockResolvedValue({ outcome: 'ok', flow: loginFlow });
      account.resolveLogin.mockResolvedValue({
        outcome: 'authenticated',
        user: { id: 'u-1', email: 'e', role: 'USER', emailVerified: true, tenantId: 't-1' },
        epoch: 0,
      });
      mocks.twoFactorChallenge.beginOrEstablish.mockResolvedValue({
        kind: 'challenge',
        methods: ['TOTP'],
      });
      const { req, res, redirectMock } = expressMocks({ query: { state: 's', code: 'c' } });

      await controller.callback('google', req, res);

      expect(redirectMock).toHaveBeenCalledWith(302, `${APP_URL}/auth/two-factor`);
    });

    it('passes a rejected resolution code through to the error redirect', async () => {
      const provider = providerFixture();
      provider.handleCallback.mockResolvedValue(identityFixture());
      const { controller, flow, account, mocks } = await buildSubject([provider]);
      flow.consume.mockResolvedValue({ outcome: 'ok', flow: loginFlow });
      account.resolveLogin.mockResolvedValue({
        outcome: 'rejected',
        errorCode: 'oauth_link_blocked',
      });
      const { req, res, redirectMock } = expressMocks({ query: { state: 's', code: 'c' } });

      await controller.callback('google', req, res);

      expectErrorRedirect(redirectMock, 'oauth_link_blocked');
      expect(mocks.twoFactorChallenge.beginOrEstablish).not.toHaveBeenCalled();
    });

    it('turns a refused mint (epoch fence lost mid-login) into the generic redirect, no cookie', async () => {
      const provider = providerFixture();
      provider.handleCallback.mockResolvedValue(identityFixture());
      const { controller, flow, account, mocks } = await buildSubject([provider]);
      flow.consume.mockResolvedValue({ outcome: 'ok', flow: loginFlow });
      account.resolveLogin.mockResolvedValue({
        outcome: 'authenticated',
        user: { id: 'u-1', email: 'e', role: 'USER', emailVerified: true, tenantId: 't-1' },
        epoch: 1,
      });
      mocks.twoFactorChallenge.beginOrEstablish.mockRejectedValue(new Error('SESSION_EXPIRED'));
      const { req, res, redirectMock } = expressMocks({ query: { state: 's', code: 'c' } });

      await controller.callback('google', req, res);

      expect(account.auditFailure).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'google' }),
        'session_mint_failed',
        expect.anything(),
      );
      expectErrorRedirect(redirectMock, 'oauth_failed');
      // A fence refusal and a Redis outage are the same audit row, so this is
      // the only place the two can be told apart.
      expectFailureReported('session_mint', 'Error');
    });

    const linkFlow = {
      ...loginFlow,
      intent: 'link' as const,
      userId: 'u-1',
      returnTo: '/settings',
    };

    it('refuses link completion when the callback arrives with no session', async () => {
      const provider = providerFixture();
      provider.handleCallback.mockResolvedValue(identityFixture());
      const { controller, flow, account } = await buildSubject([provider]);
      flow.consume.mockResolvedValue({ outcome: 'ok', flow: linkFlow });
      const { req, res, redirectMock } = expressMocks({ query: { state: 's', code: 'c' } });

      await controller.callback('google', req, res);

      expect(account.resolveLogin).not.toHaveBeenCalled();
      expect(account.completeLink).not.toHaveBeenCalled();
      expect(account.auditFailure).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'google' }),
        'link_no_session',
        expect.anything(),
      );
      expectErrorRedirect(redirectMock, 'oauth_failed');
    });

    it('completes a link: session user + flow pin handed to completeLink, NO session minted', async () => {
      const provider = providerFixture();
      const identity = identityFixture();
      provider.handleCallback.mockResolvedValue(identity);
      const { controller, flow, account, mocks } = await buildSubject([provider]);
      const init = withSession(mocks);
      flow.consume.mockResolvedValue({ outcome: 'ok', flow: linkFlow });
      account.completeLink.mockResolvedValue({ outcome: 'linked' });
      const { req, res, redirectMock } = expressMocks({
        ...init,
        query: { state: 's', code: 'c' },
      });

      await controller.callback('google', req, res);

      expect(account.completeLink).toHaveBeenCalledWith(identity, 'u-1', 'u-1', expect.anything());
      // The session that started the flow finishes it: the seam is never
      // involved and no new session appears.
      expect(mocks.twoFactorChallenge.beginOrEstablish).not.toHaveBeenCalled();
      expect(mocks.shared.establishSession).not.toHaveBeenCalled();
      expect(redirectMock).toHaveBeenCalledWith(302, `${APP_URL}/settings?oauth_linked=google`);
    });

    it('passes a rejected link completion code through to the error redirect', async () => {
      const provider = providerFixture();
      provider.handleCallback.mockResolvedValue(identityFixture());
      const { controller, flow, account, mocks } = await buildSubject([provider]);
      const init = withSession(mocks);
      flow.consume.mockResolvedValue({ outcome: 'ok', flow: linkFlow });
      account.completeLink.mockResolvedValue({
        outcome: 'rejected',
        errorCode: 'oauth_account_exists',
      });
      const { req, res, redirectMock } = expressMocks({
        ...init,
        query: { state: 's', code: 'c' },
      });

      await controller.callback('google', req, res);

      expectErrorRedirect(redirectMock, 'oauth_account_exists');
    });
  });
});
