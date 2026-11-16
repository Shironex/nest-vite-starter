import { describe, expect, it } from 'vitest';
import { PRODUCT_NAME } from '@repo/shared/constants';
import { pageTitle } from './page-title';
import enLocale from './i18n/locales/en.json';

/**
 * Every route was titled "SaaS Starter" before this, so navigation was silent for
 * assistive tech and a user with several tabs could not tell one from another.
 */
describe('pageTitle', () => {
  it('names the page from the catalog and keeps the product on the end', () => {
    expect(pageTitle('pageTitle.workspaces')).toEqual({
      meta: [{ title: `${enLocale.common.pageTitle.workspaces} | ${PRODUCT_NAME}` }],
    });
  });

  it('uses the same keys the topbar heading reads', () => {
    // findNavItemForPath resolves /audit to `pageTitle.audit`; the tab title and
    // the visible <h1> must not be able to say different things.
    expect(pageTitle('pageTitle.audit').meta[0]?.title).toBe(
      `${enLocale.common.pageTitle.audit} | ${PRODUCT_NAME}`,
    );
  });

  it('covers the auth surfaces that have no nav entry', () => {
    for (const key of ['pageTitle.signIn', 'pageTitle.twoFactor'] as const) {
      const title = pageTitle(key).meta[0]?.title ?? '';
      // A missing key would come back as the bare key next to the product name.
      expect(title).not.toContain('pageTitle.');
      expect(title.endsWith(` | ${PRODUCT_NAME}`)).toBe(true);
    }
  });
});
