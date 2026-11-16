import { Link } from '@tanstack/react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/card';
import { useSetTopbarSubtitle } from '@/stores/topbar-store';
import { useDashboardPage } from './DashboardPage.hooks';
import { dashboardStrings } from '@/features/dashboard/Dashboard.strings';

/**
 * The authenticated home page: a greeting and a "start here" card.
 *
 * It starts deliberately empty. A dashboard tile with no real figure behind
 * it is a false claim, so this page carries only who is signed in and where a
 * fork starts building. Replace the card when a feature has something worth
 * putting on the first screen.
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

  const steps = dashboardStrings.startHere.steps.map((step) => <li key={step}>{step}</li>);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-0.5" data-slot="dashboard-greeting">
        <p className="type-heading-h1 text-text">{v.greeting}</p>
        <p className="type-body-regular text-text-muted">{v.subtitle}</p>
      </header>

      <Card data-slot="dashboard-start-here" className="max-w-2xl">
        <CardHeader>
          <CardTitle>{dashboardStrings.startHere.title}</CardTitle>
          <CardDescription>{dashboardStrings.startHere.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="list-decimal space-y-1.5 pl-5 type-body-regular text-text-secondary">
            {steps}
          </ol>
          <Link
            to="/settings"
            search={{ section: 'security' }}
            className="inline-flex rounded-sm type-body-medium text-brand-ink underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {dashboardStrings.startHere.securityLink}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
