export interface ITourLauncherView {
  /**
   * False on a screen with no tour, and on a screen whose tour has no anchor in
   * the DOM. An empty tour is not a tour, and offering help that cannot run is
   * worse than offering none, so the control is absent rather than disabled.
   */
  readonly isAvailable: boolean;
  readonly label: string;
  readonly tooltip: string;
  readonly isRunning: boolean;
  readonly onStart: () => void;
}
