import { describe, expect, it } from 'vitest';
import { LOGIN_PATH, loginPathForExpiredSession, pendingSkeletonForPath } from './shell-routes';

/**
 * The session-expiry bounce, pinned as a pure mapping.
 *
 * The failure mode it guards is silent in the browser: a bounce fired while
 * already on a sign-in screen is an infinite navigation loop, which is exactly
 * what a REFUSED sign-in attempt (a 401) would otherwise cause.
 */
describe('loginPathForExpiredSession', () => {
  it.each([['/dashboard'], ['/audit'], ['/settings'], ['/']])(
    'sends %s to the sign-in path',
    (pathname) => {
      expect(loginPathForExpiredSession(pathname)).toBe(LOGIN_PATH);
    },
  );

  it.each([['/auth/login'], ['/auth/register'], ['/auth/two-factor'], ['/auth/reset-password']])(
    'refuses to bounce %s, which is already a sign-in surface',
    (pathname) => {
      expect(loginPathForExpiredSession(pathname)).toBeUndefined();
    },
  );
});

describe('pendingSkeletonForPath', () => {
  it.each([
    ['/dashboard', 'cards'],
    ['/audit', 'list'],
    ['/settings', 'detail'],
    ['/settings/security', 'detail'],
    ['/workspaces/f_1', 'detail'],
  ] as const)('maps %s to the %s silhouette', (pathname, variant) => {
    expect(pendingSkeletonForPath(pathname)).toBe(variant);
  });
});
