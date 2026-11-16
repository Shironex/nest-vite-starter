import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every route gets a real CatchBoundary, whether or not it declares one.
 *
 * WITHOUT `defaultErrorComponent`, router-core resolves a route's boundary to a
 * plain fragment when the route names no error component, so a render throw in
 * any leaf travels past the whole route tree to the `@repo/ui` ErrorBoundary the
 * shells wrap around `<Outlet/>`. That fallback tears down the content region,
 * and its retry only clears React state: for a load-phase failure the match is
 * still in `status: 'error'` and rethrows on the next render, so the button
 * visibly does nothing.
 *
 * Read from source rather than by importing `main.tsx`, which mounts the app on
 * import. The failure this guards is a deleted line, and a deleted line is
 * exactly what a source assertion can see.
 */
const MAIN = readFileSync(join(import.meta.dirname, '..', 'main.tsx'), 'utf8');

describe('router defaults', () => {
  it('declares a default error component alongside the default pending one', () => {
    expect(MAIN).toMatch(/defaultErrorComponent:\s*RouteErrorComponent/u);
    expect(MAIN).toMatch(/defaultPendingComponent:\s*RoutePendingSkeleton/u);
  });

  it('pairs reset with an invalidate, so the default retry re-runs the load', () => {
    const body = /function RouteErrorComponent\([\s\S]*?\n\}/u.exec(MAIN)?.[0];

    expect(body, 'main.tsx defines RouteErrorComponent').toBeDefined();
    expect(body).toContain('reset();');
    expect(body).toContain('router.invalidate()');
  });

  // The shells' ErrorBoundary fallback is a hardcoded default; anything a route
  // boundary renders has to come from the strings tables instead.
  it('renders app copy rather than the raw error message', () => {
    const body = /function RouteErrorComponent\([\s\S]*?\n\}/u.exec(MAIN)?.[0] ?? '';

    expect(body).toContain('translateAppError(error)');
    expect(body).toContain('commonStrings.errors.unexpected');
    // The raw message is a beforeLoad internal or an asset URL; DEV only.
    expect(body).toMatch(/import\.meta\.env\.DEV && error instanceof Error/u);
  });

  it('bounces an expired session to a sign-in screen', () => {
    expect(MAIN).toContain('UNAUTHORIZED_EVENT');
    expect(MAIN).toContain('loginPathForExpiredSession');
  });
});
