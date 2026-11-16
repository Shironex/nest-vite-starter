import { useRouterState } from '@tanstack/react-router';
import { useAuth } from '@/hooks/use-auth';
import { NAV_GROUPS, isActivePath } from '@/features/layout/Layout.nav';
import type { IAppSidebarView, INavGroup } from './AppSidebar.types';
import { layoutStrings } from '@/features/layout/Layout.strings';

export function useAppSidebar(): IAppSidebarView {
  const routerState = useRouterState();
  const { user } = useAuth();
  const currentPath = routerState.location.pathname;

  const groups: INavGroup[] = NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items
      .filter((item) => !item.role || item.role === user?.role)
      .map((item) => ({
        title: item.title,
        href: item.href,
        icon: item.icon,
        isActive: isActivePath(currentPath, item.href),
      })),
    // A group whose every entry is role-gated away would otherwise render as a
    // bare heading with nothing under it.
  })).filter((group) => group.items.length > 0);

  return {
    groups,
    navLabel: layoutStrings.nav.primary,
  };
}
