import type { ComponentType } from 'react';

/** A navigation destination, resolved for the current user and route. */
export interface IActiveNavItem {
  readonly title: string;
  readonly href: string;
  readonly icon: ComponentType<{ className?: string }>;
  readonly isActive: boolean;
}

/** A labeled group of nav links, rendered as its own sidebar section. */
export interface INavGroup {
  readonly label: string;
  readonly items: readonly IActiveNavItem[];
}

export interface IAppSidebarView {
  /** Sections in render order. A group with no visible item is dropped. */
  readonly groups: readonly INavGroup[];
  /** Accessible name for the `<nav>` landmark. */
  readonly navLabel: string;
}
