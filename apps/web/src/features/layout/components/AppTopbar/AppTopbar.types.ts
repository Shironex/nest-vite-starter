import type { ReactNode } from 'react';

export interface IAppTopbarProps {
  /**
   * Slot for the notification bell. The bell belongs to the `notifications`
   * feature, and `no-cross-feature-imports` stops `layout` reaching for it, so
   * the layout route composes the two instead.
   */
  readonly notifications?: ReactNode;
  /**
   * Slot for the per-screen guided-tour control, on the same terms as the bell:
   * it belongs to the `help` feature, so the layout route composes it in.
   *
   * It sits BEFORE the bell rather than after it. The two are both topbar
   * affordances, but one is a standing offer and the other is an interruption,
   * and the reading order should put the thing you can always ask for first.
   */
  readonly help?: ReactNode;
}

export interface IAppTopbarView {
  /**
   * The `<h1>` for the current route. The shell owns it, so no page inside
   * `_authenticated` renders one: the topbar draws this row on every route, and
   * a page-level `<h1>` would be a second document heading competing with it.
   * `e2e/app-shell-headings.spec.ts` pins the one-per-route count.
   */
  readonly title: string;
  /**
   * Optional context line under the title, published by the mounted page via
   * `useSetTopbarSubtitle`. The design fills it per route with live data (a
   * localized date on the dashboard, record counts on a list screen), which
   * is why it is a published slot rather than a static key in `Layout.nav`.
   * A page that publishes nothing leaves the shell rendering the title alone.
   */
  readonly subtitle: string | null;
}
