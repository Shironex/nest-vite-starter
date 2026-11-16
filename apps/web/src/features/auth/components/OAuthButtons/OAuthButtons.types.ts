import type { OAuthProviderKey } from '@/features/auth/Auth.constants';

/** One renderable provider: the discovered key plus the localized call to action. */
export interface IOAuthProviderOption {
  readonly key: OAuthProviderKey;
  readonly label: string;
}

export interface IOAuthButtonsView {
  /** Empty whenever the surface must stay hidden: no providers, or Electron. */
  readonly providers: readonly IOAuthProviderOption[];
  readonly dividerLabel: string;
  readonly onSelect: (key: OAuthProviderKey) => void;
}
