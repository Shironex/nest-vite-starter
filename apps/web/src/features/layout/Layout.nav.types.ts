import type { ComponentType } from 'react';
import type { Role } from '@repo/shared/permissions';

/** One navigation destination. Copy comes from the layout and shared strings tables. */
export interface INavItemConfig {
  readonly title: string;
  /** Topbar heading for the route, which can differ from the sidebar label. */
  readonly pageTitle: string;
  readonly href: string;
  readonly icon: ComponentType<{ className?: string }>;
  /** When set, only this role sees the entry. */
  readonly role?: Role;
}

/** A labeled section of the sidebar, rendered under its own overline heading. */
export interface INavGroupConfig {
  readonly label: string;
  readonly items: readonly INavItemConfig[];
}
