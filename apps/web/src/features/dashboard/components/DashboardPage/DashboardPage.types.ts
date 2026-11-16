export interface IDashboardPageView {
  /** "Good day, <name>", already interpolated. */
  readonly greeting: string;
  readonly subtitle: string;
  /**
   * "Tuesday, July 14, 2026", published as the topbar subtitle. The design
   * puts it under the page title, not in the page body.
   */
  readonly todayLabel: string;
}
