import { PRODUCT_NAME } from '@repo/shared/constants';
import { i18n } from './i18n';

/**
 * The `<title>` for one route, as TanStack's `head()` wants it.
 *
 * WITHOUT A PER-ROUTE TITLE every route in the app was "SaaS Starter": navigation was
 * silent for assistive tech (no title change, nothing announced), the browser
 * history read as one entry repeated, and a user with several tabs open could
 * not tell the audit log from settings.
 *
 * `i18n.t` rather than a hook, because `head()` is route config: it is
 * evaluated by the router outside React, before (and independently of) the
 * component that will render. For the same reason every key here lives in the
 * bundled `common` namespace rather than in a feature catalog, which a route
 * cannot rely on having been registered yet.
 */
export function pageTitle(pageTitleKey: string): { meta: Array<{ title: string }> } {
  return { meta: [{ title: `${i18n.t(pageTitleKey)} | ${PRODUCT_NAME}` }] };
}
