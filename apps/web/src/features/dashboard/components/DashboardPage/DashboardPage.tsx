import { useSetTopbarSubtitle } from '@/stores/topbar-store';
// Side effect: registers this feature's catalogs. Needed HERE and not only in
// the hook file, because a component test mocks the hook module away.
import '../../Dashboard.i18n';
import { useDashboardPage } from './DashboardPage.hooks';

/**
 * The authenticated landing page: a greeting.
 *
 * It starts deliberately small. A dashboard tile with no real figure behind
 * it is a false claim, so this page carries only what the platform has: who
 * is signed in. Add a panel here when a feature
 * has a number worth putting on the first screen.
 *
 * There is deliberately no `<h1>` here. The app shell's topbar renders the
 * page title for every route, so a page-level heading would compete with it;
 * this greeting is a welcome line, not the document heading.
 */
export default function DashboardPage() {
  const v = useDashboardPage();

  // The design puts the date under the TITLE, in the topbar, not in the page
  // body. The shell owns that row, so the page publishes into it.
  useSetTopbarSubtitle(v.todayLabel);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-0.5" data-slot="dashboard-greeting">
        <p className="type-heading-h1 text-text">{v.greeting}</p>
        <p className="type-body-regular text-text-muted">{v.subtitle}</p>
      </header>
    </div>
  );
}
