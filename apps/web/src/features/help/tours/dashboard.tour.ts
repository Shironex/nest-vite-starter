import type { ITour } from '../Help.types';

/**
 * The orientation tour. It is the first thing a new member of the organization sees,
 * so it walks the SHELL (sidebar, help control, bell, account menu) before it
 * says anything about the dashboard itself: everything else in the app is
 * reached through those four, and a person who has not been shown them cannot
 * get to the screen their own tour is on.
 */
export const dashboardTour: ITour = {
  id: 'dashboard',
  route: '/dashboard',
  version: 1,
  steps: [
    { anchor: 'app-sidebar', side: 'right', align: 'start' },
    { anchor: 'app-help', side: 'bottom', align: 'end' },
    { anchor: 'app-notifications', side: 'bottom', align: 'end' },
    { anchor: 'app-user-menu', side: 'bottom', align: 'end' },
    { anchor: 'dashboard-activity', side: 'top', align: 'start' },
  ],
};
