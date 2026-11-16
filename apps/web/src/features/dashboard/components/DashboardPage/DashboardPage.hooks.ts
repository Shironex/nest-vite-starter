import { useState } from 'react';
import { formatLongDate } from '@/lib/format';
import { useDashboardUser } from '../../Dashboard.queries';
import type { IDashboardPageView } from './DashboardPage.types';
import { dashboardStrings } from '@/features/dashboard/Dashboard.strings';

/**
 * The greeting names whoever is signed in.
 *
 * `displayName` first, then the email, then a neutral fallback: the header must
 * never read "Good day, undefined" while `user.me` is still in flight, and
 * it must not guess a first name by splitting `displayName` on a space, which
 * mangles compound and multi-part names.
 *
 * With no display name set the fallback is the email's LOCAL PART, not the
 * whole address: the recon screenshots caught "Good day, admin@example.com"
 * greeting the user with a mailbox. The local part is the handle the account
 * already goes by, so it is a real name for the account rather than an invented
 * one for the person, and the actual fix stays where it belongs: on the
 * profile, where a user sets a display name.
 */
export function useDashboardPage(): IDashboardPageView {
  const { data } = useDashboardUser();

  const name =
    data?.displayName ?? data?.email?.split('@')[0] ?? dashboardStrings.greeting.fallbackName;

  // Read the clock once per mount so the date cannot change identity between
  // two renders. A bare clock read in render scope is impure, and this value
  // feeds the published topbar subtitle, which is an effect that would
  // otherwise re-publish on every render.
  const [today] = useState(() => new Date());

  return {
    greeting: dashboardStrings.greeting.title({ name }),
    subtitle: dashboardStrings.greeting.subtitle,
    todayLabel: formatLongDate(today),
  };
}
