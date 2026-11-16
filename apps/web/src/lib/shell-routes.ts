import type { PageSkeletonVariant } from '@repo/ui/page-skeleton';

/**
 * Where the app starts, and where sign-in lives.
 *
 * IN `lib/` RATHER THAN IN A FEATURE, and not for tidiness. The app shell, the
 * auth layout and the sign-in form all have to agree on these paths, and they
 * live in different feature folders
 * that `no-cross-feature-imports` deliberately keeps apart. A route path is not
 * a feature's internal business anyway: it is a fact about the router, which is
 * what `lib/` is for. Putting it in one feature would either force an illegal
 * import or leave the same literal written out in four places, and the failure
 * mode of the second is a sign-in that lands somebody in the wrong shell.
 */

/** Where a signed-in account starts. */
export const STAFF_HOME_PATH = '/dashboard';

/** The sign-in screen. */
export const LOGIN_PATH = '/auth/login';

/** Path prefixes that already ARE a sign-in surface, so a bounce is a loop. */
const AUTH_PATH_PREFIXES = ['/auth'] as const;

/**
 * Where a session-expiry bounce should send somebody standing on `pathname`,
 * or `undefined` when it must not bounce at all.
 *
 * Pure and separate from the listener that calls it because the failure mode
 * is silent: bouncing somebody who is ALREADY on a sign-in screen is an
 * infinite navigation loop, and the 401 that triggers it is exactly what a
 * failed sign-in attempt produces.
 */
export function loginPathForExpiredSession(pathname: string): string | undefined {
  if (AUTH_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return undefined;
  return LOGIN_PATH;
}

/**
 * Which silhouette a shell holds in its content region while `pathname`
 * resolves.
 *
 * The mapping lives here with the paths rather than in a feature's nav config,
 * because the router-level default in `main.tsx` has to answer for any path
 * and `no-cross-feature-imports` keeps features apart.
 *
 * Keyed on prefix and deliberately coarse. The point of the skeleton is that
 * the eye recognizes the SHAPE of what is coming, and the product has three
 * shapes: a tile grid, a list, and a record. Anything unmatched reads as a
 * record, because the routes outside the nav are the deep ones.
 */
export function pendingSkeletonForPath(pathname: string): PageSkeletonVariant {
  if (pathname === STAFF_HOME_PATH) return 'cards';
  if (pathname.startsWith('/settings')) return 'detail';
  if (LIST_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return 'list';
  return 'detail';
}

/** Surfaces that are a table or a roster. */
const LIST_PATH_PREFIXES = ['/admin'] as const;
