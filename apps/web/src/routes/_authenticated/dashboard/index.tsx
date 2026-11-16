import { createFileRoute } from '@tanstack/react-router';
import { pageTitle } from '@/lib/page-title';
import { DashboardPage } from '@/features/dashboard/components/DashboardPage';
import { commonStrings } from '@/lib/strings';

/**
 * The authenticated landing page.
 *
 * A route is the seam that may compose two features, since
 * `no-cross-feature-imports` fences one feature off from another. The page
 * needs nothing from another feature today, so the seam carries nothing.
 */
export const Route = createFileRoute('/_authenticated/dashboard/')({
  head: () => pageTitle(commonStrings.pageTitle.dashboard),
  component: DashboardPage,
});
