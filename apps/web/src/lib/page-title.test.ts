import { describe, expect, it } from 'vitest';
import { PRODUCT_NAME } from '@repo/shared/constants';
import { pageTitle } from './page-title';
import { commonStrings } from './strings';

/**
 * Every route was titled "SaaS Starter" before this, so navigation was silent for
 * assistive tech and a user with several tabs could not tell one from another.
 */
describe('pageTitle', () => {
  it('names the page from the strings table and keeps the product on the end', () => {
    expect(pageTitle(commonStrings.pageTitle.admin)).toEqual({
      meta: [{ title: `${commonStrings.pageTitle.admin} | ${PRODUCT_NAME}` }],
    });
  });

  it('uses the same keys the topbar heading reads', () => {
    // findNavItemForPath resolves /admin to `commonStrings.pageTitle.admin`; the tab title and
    // the visible <h1> must not be able to say different things.
    expect(pageTitle(commonStrings.pageTitle.admin).meta[0]?.title).toBe(
      `${commonStrings.pageTitle.admin} | ${PRODUCT_NAME}`,
    );
  });

  it('covers the auth surfaces that have no nav entry', () => {
    for (const text of [commonStrings.pageTitle.signIn, commonStrings.pageTitle.twoFactor]) {
      const title = pageTitle(text).meta[0]?.title ?? '';
      expect(title).toBe(`${text} | ${PRODUCT_NAME}`);
    }
  });
});
