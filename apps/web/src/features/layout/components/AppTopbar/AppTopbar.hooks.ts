import { useRouterState } from '@tanstack/react-router';
import { PRODUCT_NAME } from '@repo/shared/constants';
import { findNavItemForPath } from '@/features/layout/Layout.nav';
import { useTopbarSubtitle } from '@/stores/topbar-store';
import type { IAppTopbarView } from './AppTopbar.types';

export function useAppTopbar(): IAppTopbarView {
  const routerState = useRouterState();
  /*
   * Published by the mounted page, not read from nav config. The design's
   * subtitles are live data (a localized date on the dashboard, a record count
   * on a list screen), so there is nothing static to key off. See `stores/topbar-store`.
   */
  const subtitle = useTopbarSubtitle();

  const item = findNavItemForPath(routerState.location.pathname);

  return {
    // Routes outside the nav (a screen with no entry of its own) fall back to the
    // product name rather than rendering an empty heading slot.
    title: item ? item.pageTitle : PRODUCT_NAME,
    subtitle,
  };
}
