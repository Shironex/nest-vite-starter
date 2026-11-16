import type { ComponentType } from 'react';
import type { Role } from '@repo/shared/permissions';

/** One navigation destination. Copy is held as i18n keys so the config stays static. */
export interface INavItemConfig {
  readonly titleKey: string;
  /** Topbar heading for the route, which can differ from the sidebar label. */
  readonly pageTitleKey: string;
  readonly href: string;
  readonly icon: ComponentType<{ className?: string }>;
  /** When set, only this role sees the entry. */
  readonly role?: Role;
}

/** A labeled section of the sidebar, rendered under its own overline heading. */
export interface INavGroupConfig {
  readonly labelKey: string;
  readonly items: readonly INavItemConfig[];
}
