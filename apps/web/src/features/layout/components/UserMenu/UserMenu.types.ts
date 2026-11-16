export interface IUserMenuLabels {
  /** Accessible name for the avatar trigger, which has no visible text label. */
  readonly trigger: string;
  readonly settings: string;
  readonly logout: string;
}

export interface IUserMenuView {
  readonly displayName: string;
  readonly email: string;
  readonly initials: string;
  /**
   * The resolved picture, or `undefined` while it resolves, when the lookup
   * failed or when the user has none: the initials show in every one of those.
   */
  readonly avatarUrl: string | undefined;
  readonly isLogoutPending: boolean;
  readonly labels: IUserMenuLabels;
  readonly onLogout: () => void;
  readonly onNavigateToSettings: () => void;
}
