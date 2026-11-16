import { Link } from '@tanstack/react-router';
import { PRODUCT_NAME } from '@repo/shared/constants';
import { NavRailBrand, navRailGroupLabelClass, navRailItemClass } from '@repo/ui/nav-rail';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@repo/ui/sidebar';
import { OrganizationIdentity } from '@/features/layout/components/OrganizationIdentity';
import { useAppSidebar } from './AppSidebar.hooks';
import type { IActiveNavItem } from './AppSidebar.types';

/*
 * The link treatment, the brand lockup and the group overline all come from
 * `@repo/ui/nav-rail`, so a second shell built on the same parts cannot drift
 * into a different active tint or lose the logo.
 *
 * The container stays local. `Sidebar` is what buys the icon rail, Cmd+B and
 * the mobile off-canvas sheet, which a simpler shell may not want.
 * `navRailItemClass` also overrides the primitive's own `data-[active=true]`
 * slots, which are colored from the shadcn `sidebar-accent` leftover rather
 * than from the brand tint the design specifies.
 */
const NAV_LINK_CLASS = navRailItemClass('comfortable');
const GROUP_LABEL_CLASS = navRailGroupLabelClass('comfortable');

function NavLink({ item }: { item: IActiveNavItem }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={item.isActive}
        tooltip={item.title}
        className={NAV_LINK_CLASS}
      >
        <Link to={item.href} aria-current={item.isActive ? 'page' : undefined}>
          <item.icon />
          <span>{item.title}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export default function AppSidebar() {
  const { groups, navLabel } = useAppSidebar();

  // Both levels are mapped here rather than in JSX: `no-jsx-computation` gates
  // the returned markup, and a nested map inside a map callback trips it too.
  const groupSections = groups
    .map((group) => ({
      label: group.label,
      links: group.items.map((item) => <NavLink key={item.href} item={item} />),
    }))
    .map((group) => (
      <SidebarGroup key={group.label} className="p-0">
        <SidebarGroupLabel className={GROUP_LABEL_CLASS}>{group.label}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu className="gap-0.5">{group.links}</SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    ));

  return (
    <Sidebar collapsible="icon" className="border-border">
      <SidebarHeader className="p-0">
        <NavRailBrand asChild mark={PRODUCT_NAME.charAt(0)} wordmark={PRODUCT_NAME}>
          <Link to="/dashboard" />
        </NavRailBrand>
      </SidebarHeader>

      <SidebarContent className="gap-0 px-3 pb-2">
        {/*
         * The sidebar primitive is a plain `div`, so the navigation landmark has
         * to be declared here. It is a real element rather than `display:
         * contents` so the landmark is exposed reliably.
         */}
        <nav aria-label={navLabel} className="flex flex-col gap-0">
          {groupSections}
        </nav>
      </SidebarContent>

      <OrganizationIdentity />
    </Sidebar>
  );
}
