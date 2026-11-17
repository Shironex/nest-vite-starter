import { APP_NAME } from '@/lib/env';

/**
 * The `<title>` for one route, as TanStack's `head()` wants it.
 *
 * WITHOUT A PER-ROUTE TITLE every route in the app was "SaaS Starter": navigation was
 * silent for assistive tech (no title change, nothing announced), the browser
 * history read as one entry repeated, and a user with several tabs open could
 * not tell the audit log from settings.
 *
 * Takes the title text itself (from `commonStrings.pageTitle`) rather than a
 * hook, because `head()` is route config: it is evaluated by the router outside
 * React, before (and independently of) the component that will render.
 */
export function pageTitle(title: string): { meta: Array<{ title: string }> } {
  return { meta: [{ title: `${title} | ${APP_NAME}` }] };
}
