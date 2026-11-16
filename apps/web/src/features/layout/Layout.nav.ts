import { History, LayoutDashboard, Settings } from 'lucide-react';
import { ROLES } from '@repo/shared/permissions';
import { commonStrings } from '@/lib/strings';
import { layoutStrings } from './Layout.strings';
import type { INavGroupConfig, INavItemConfig } from './Layout.nav.types';

/**
 * The single source of truth for the app shell's navigation. The sidebar renders
 * it as links; the topbar reads it to resolve the current page title.
 *
 * Every entry points at a route that exists under `src/routes/_authenticated/`.
 * A screen with no route gets no entry: a link pointing at nothing is worse
 * than no link.
 */
export const NAV_GROUPS: readonly INavGroupConfig[] = [
  {
    label: layoutStrings.nav.groupMain,
    items: [
      {
        title: layoutStrings.nav.dashboard,
        pageTitle: commonStrings.pageTitle.dashboard,
        href: '/dashboard',
        icon: LayoutDashboard,
      },
      /*
       * ADMIN-only like the reminder settings below: hiding the link is a
       * courtesy, the audit.list procedure's AdminMiddleware is the control.
       */
      {
        title: layoutStrings.nav.audit,
        pageTitle: commonStrings.pageTitle.audit,
        href: '/audit',
        icon: History,
        role: ROLES.ADMIN,
      },
    ],
  },
  {
    label: layoutStrings.nav.groupSettings,
    items: [
      {
        title: layoutStrings.nav.settings,
        pageTitle: commonStrings.pageTitle.settings,
        href: '/settings',
        icon: Settings,
      },
    ],
  },
];

/**
 * Segment-aware match, so `/audit/a-1` lights up `/audit` while `/settings`
 * stays dark on `/settings-archive`. A bare `startsWith` would match a sibling
 * route that merely shares a name prefix.
 */
export function isActivePath(currentPath: string, href: string): boolean {
  return currentPath === href || currentPath.startsWith(`${href}/`);
}

/**
 * The deepest matching entry wins, so a future `/settings/sessions` entry would
 * beat the `/settings` entry rather than tying with it.
 */
export function findNavItemForPath(
  currentPath: string,
  groups: readonly INavGroupConfig[] = NAV_GROUPS,
): INavItemConfig | null {
  const matches = groups
    .flatMap((group) => group.items)
    .filter((item) => isActivePath(currentPath, item.href))
    .sort((a, b) => b.href.length - a.href.length);

  return matches[0] ?? null;
}
