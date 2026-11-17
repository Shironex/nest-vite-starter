import { useState } from 'react';
import { APP_NAME } from '@/lib/env';
import { landingStrings } from '../../Landing.strings';
import type { ILandingPageView } from './LandingPage.types';

/**
 * Everything the page reads: the product name from the one place that owns it
 * (`APP_NAME`), so a rename never has to touch this page, and the year for
 * the footer, read once per mount because a clock read in render is impure.
 */
export function useLandingPage(): ILandingPageView {
  const [year] = useState(() => new Date().getFullYear());

  return {
    productName: APP_NAME,
    productMark: APP_NAME.charAt(0),
    copyright: landingStrings.footer.copyright({ year, productName: APP_NAME }),
  };
}
