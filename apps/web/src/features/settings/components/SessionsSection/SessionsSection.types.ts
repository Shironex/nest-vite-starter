/**
 * One active session, formatted for display. `id` is the opaque revoke handle
 * from `sessions.list`, never the server-side session id; the current-device
 * row carries no revoke action (logout owns that flow), so `isCurrent` is what
 * the panel keys both the badge and the button's absence on.
 */
export interface ISessionRow {
  readonly id: string;
  /** Browser and OS parsed from the user agent, or the unknown-device copy. */
  readonly deviceLabel: string;
  readonly ip: string;
  readonly signedIn: string;
  readonly lastActive: string;
  readonly isCurrent: boolean;
  /** Phone/tablet user agents draw the smartphone tile instead of the monitor. */
  readonly isMobile: boolean;
  /**
   * The visible "Sign out" label stays a prefix of this accessible name (WCAG
   * 2.5.3), which also carries the device and IP so rows of the same browser
   * stay distinguishable to assistive tech.
   */
  readonly revokeAccessibleLabel: string;
}

export interface ISessionsSectionView {
  /**
   * What the list shows. One value rather than three booleans the shell has to
   * combine, and the same vocabulary every other list surface in the app uses,
   * so loading, empty and error all REPLACE the rows instead of sitting beside
   * a half-rendered list.
   */
  readonly state: 'ready' | 'loading' | 'empty' | 'error';
  readonly rows: readonly ISessionRow[];
  readonly onRevoke: (id: string) => void;
  /** True while any revoke call is in flight; every row action is held. */
  readonly isRevokePending: boolean;
  /** The row whose revoke is in flight, so only it draws the spinner. */
  readonly revokingId: string | null;
  /** False when the caller's device is the only session; the action hides. */
  readonly hasOtherSessions: boolean;
  readonly onRevokeOthers: () => void;
  readonly isRevokeOthersPending: boolean;
  readonly isConfirmOpen: boolean;
  readonly onConfirmOpenChange: (open: boolean) => void;
}
