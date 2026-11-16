import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The application shell stays off the first-paint graph.
 *
 * The app shell (`/_authenticated`) draws its FULL chrome as a pending state,
 * on purpose: a navigation that
 * blanked the sidebar and topbar would read as the app having failed rather
 * than as it being busy. The cost is that whatever the pending state renders is
 * reachable from the route's config object, and the router plugin's DEFAULT
 * groupings split `component`, `errorComponent` and `notFoundComponent` but
 * leave `pendingComponent` in the entry graph. So the default put the shell in
 * front of every visitor, including the sign-in screen, which never renders it.
 *
 * `pnpm size:check` DOES catch a regression here, unlike the English case, but
 * it catches it as a number with no explanation, in a job that runs after the
 * change is written. Deleting one line from
 * `codeSplittingOptions` looks like tidying an option back to its default, and
 * the failure it produces names a byte count rather than the cause. This test
 * is the one that says what actually broke.
 */
const WEB_ROOT = join(import.meta.dirname, '..', '..');

describe('the shells stay out of the entry chunk', () => {
  it('splits pendingComponent along with the other route nodes', () => {
    const config = readFileSync(join(WEB_ROOT, 'vite.config.ts'), 'utf8');

    const groupings = /defaultBehavior:\s*\[(?<body>[\s\S]*?)\]\s*,?\s*\}/u.exec(config)?.groups
      ?.body;

    expect(groupings, 'vite.config.ts declares codeSplittingOptions.defaultBehavior').toBeDefined();
    for (const node of ['component', 'pendingComponent', 'errorComponent', 'notFoundComponent']) {
      expect(groupings).toContain(`'${node}'`);
    }
  });

  it.each([['staff', join('src', 'routes', '_authenticated.tsx')]])(
    'keeps the %s layout drawing its shell while it waits',
    (_name, route) => {
      // The split above only matters while these routes still render chrome from
      // a pendingComponent. If one stopped, the option would be guarding nothing
      // and this test would be passing for the wrong reason.
      expect(readFileSync(join(WEB_ROOT, route), 'utf8')).toContain('pendingComponent:');
    },
  );
});
