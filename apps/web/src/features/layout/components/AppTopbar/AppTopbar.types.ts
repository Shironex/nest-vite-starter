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
