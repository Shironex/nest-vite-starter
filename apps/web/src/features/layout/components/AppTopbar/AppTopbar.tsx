import { SidebarTrigger } from '@repo/ui/sidebar';
import { ConnectionIndicator } from '@/features/layout/components/ConnectionIndicator';
import { UserMenu } from '@/features/layout/components/UserMenu';
import { useAppTopbar } from './AppTopbar.hooks';
import type { IAppTopbarProps } from './AppTopbar.types';

export default function AppTopbar({ notifications, help }: IAppTopbarProps) {
  const { title, subtitle } = useAppTopbar();

  const subtitleNode = subtitle ? (
    <p className="truncate type-body-small text-text-tertiary">{subtitle}</p>
  ) : null;

  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-border bg-surface px-4 md:px-7">
      {/*
       * The design has no trigger, but it is the only way to reach the sidebar
       * once it collapses to the icon rail on desktop or off-canvas on mobile,
       * so it stays and leads the focus order.
       */}
      <SidebarTrigger className="-ml-1" />
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        {/*
         * The document heading for every authenticated route. `type-heading-h2`
         * is the design's scale for this row and stays: only the semantics move.
         */}
        <h1 className="truncate type-heading-h2 text-text">{title}</h1>
        {subtitleNode}
      </div>
      <ConnectionIndicator />
      {help}
      {/*
       * `data-tour` anchors, and nothing more: an attribute the orientation
       * tour selects on. Deliberately not a class and deliberately not the
       * component's own markup, so restyling either of these cannot break the
       * tour that points at them.
       */}
      <span data-tour="app-notifications">{notifications}</span>
      <span data-tour="app-user-menu">
        <UserMenu />
      </span>
    </header>
  );
}
