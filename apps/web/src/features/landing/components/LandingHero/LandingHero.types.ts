export interface IHeroMockRow {
  initials: string;
  name: string;
  role: string;
  /**
   * Token-backed avatar plate AND its ink, e.g. `bg-success-bg text-success`.
   * Both halves live here on purpose: the pairing has to be one a contrast
   * check can assert, and a plate without its ink is half a decision.
   */
  avatarClassName: string;
  /** The design drops the last row on the mobile frame. */
  desktopOnly?: boolean;
}

export interface ILandingHeroView {
  rows: IHeroMockRow[];
}
