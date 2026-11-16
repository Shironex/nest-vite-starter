import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/** One row of the settings rail, together with the panel it reveals. */
export interface ISettingsSection {
  /** Stable key, and the value the rail row is selected by. */
  readonly id: string;
  /** Rail label, taken from the design. */
  readonly label: string;
  readonly icon: LucideIcon;
  /**
   * The panel body. A React element is inert until it is rendered, so the
   * sections that are not selected never mount and never fire their queries.
   */
  readonly panel: ReactNode;
}

export interface ISettingsShellProps {
  /**
   * Composed by the route rather than by this component: the panels live in
   * `features/admin` and `features/two-factor` as well as `features/settings`,
   * and `no-cross-feature-imports` forbids one feature importing another's
   * runtime code in either direction. Routes are not gated by that rule, so the
   * route is the one place allowed to assemble them.
   */
  readonly sections: readonly ISettingsSection[];
  /**
   * Which rail row opens first, instead of the first one. Set by the route
   * when a redirect carries the user to a specific panel (the OAuth link
   * callback lands on `/settings?oauth_linked=...` and must open the panel
   * that announces it, which only mounts while its section is selected).
   * An id not in `sections` falls back to the first row like any stale id.
   * A later CHANGE to a defined id selects that row again (a deep link that
   * arrives while the shell is mounted); a change to `undefined` keeps the
   * current row.
   * `| undefined` spelled out for exactOptionalPropertyTypes: the route passes
   * a conditional expression, not an omitted key.
   */
  readonly initialSectionId?: string | undefined;
}

export interface ISettingsShellView {
  /** The section currently on screen; falls back to the first row. */
  readonly active: ISettingsSection | undefined;
  readonly onSelect: (id: string) => void;
}
