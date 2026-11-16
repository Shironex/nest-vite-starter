export interface IGraceBannerView {
  /** True while the tenant requires 2FA, the user has none, and grace still runs. */
  readonly show: boolean;
  /** Localized grace deadline, or null when the policy carries no deadline. */
  readonly deadlineLabel: string | null;
}
