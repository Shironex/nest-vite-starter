import type { OAuthProviderKey } from '@/features/auth/Auth.constants';

/**
 * One linked account, formatted for display. Keyed by the OAuthAccount row
 * `id`, never the provider: a user CAN link two Google accounts, so the
 * provider key alone cannot address a row for unlinking.
 */
export interface IConnectedAccountRow {
  readonly id: string;
  readonly providerName: string;
  /** The provider-side e-mail snapshot; may differ from the account e-mail. */
  readonly email: string;
  readonly linkedOn: string;
  readonly lastUsed: string;
  /**
   * The visible "Unlink" label stays a prefix of this accessible name (WCAG
   * 2.5.3), which also carries the e-mail so two rows of the same provider
   * stay distinguishable to assistive tech.
   */
  readonly unlinkAccessibleLabel: string;
}

/** One provider that is enabled on the api but not linked yet. */
export interface IOAuthLinkOption {
  readonly key: OAuthProviderKey;
  readonly label: string;
}

export interface IConnectedAccountsSectionView {
  /**
   * What the list shows. One value rather than three booleans the shell has to
   * combine, and the same vocabulary every other list surface in the app uses,
   * so loading, empty and error all REPLACE the rows instead of sitting beside
   * a half-rendered list.
   */
  readonly state: 'ready' | 'loading' | 'empty' | 'error';
  readonly rows: readonly IConnectedAccountRow[];
  readonly linkOptions: readonly IOAuthLinkOption[];
  readonly onLink: (key: OAuthProviderKey) => void;
  readonly onUnlink: (accountId: string) => void;
  /** True while any unlink call is in flight; every row action is held. */
  readonly isUnlinkPending: boolean;
  /** The row whose unlink is in flight, so only it draws the spinner. */
  readonly unlinkingId: string | null;
  readonly isDialogOpen: boolean;
  readonly onDialogOpenChange: (open: boolean) => void;
  readonly onSudoConfirmed: () => void;
}
