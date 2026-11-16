import { SidebarTrigger } from '@repo/ui/sidebar';
import { UserMenu } from '@/features/layout/components/UserMenu';
import { useAppTopbar } from './AppTopbar.hooks';

export default function AppTopbar() {
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
      <UserMenu />
    </header>
  );
}
