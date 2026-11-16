import type { ITour, ITourStep } from './Help.types';
import { dashboardTour } from './tours/dashboard.tour';

/**
 * THE REGISTRY. Every guided tour in the app, in the order the settings list
 * shows them.
 *
 * ADDING A TOUR IS THREE EDITS AND NOTHING ELSE:
 *
 *   1. `tours/<screen>.tour.ts`, a plain `ITour` naming its route and its
 *      `data-tour` anchors.
 *   2. One import and one entry in the array below.
 *   3. A `tours.<id>` block in both catalogs under `locales/`.
 *
 * Then put `data-tour="<anchor>"` on the elements. No engine change, no
 * migration, no api change, and `Help.catalog.test.ts` fails loudly if the copy
 * is missing in either language.
 *
 * The tours live HERE rather than in each feature folder on purpose: a registry
 * in `help` that imported a tour file from another feature folder would be a
 * cross-feature import, which `no-cross-feature-imports` refuses and rightly
 * so. Keeping the data in one folder also means "add a tour" is one directory
 * to look in rather than a convention to remember. What DOES live in the
 * feature is the anchor attribute, which is just markup.
 */
export const TOURS: readonly ITour[] = [dashboardTour];

/** The CSS selector for an anchor. The one place the attribute name is written. */
export function tourAnchorSelector(anchor: string): string {
  return `[data-tour="${anchor}"]`;
}

/** The i18n keys for one step, derived from the tour and the anchor. */
export function tourStepKeys(
  tour: ITour,
  step: ITourStep,
): {
  titleKey: string;
  bodyKey: string;
} {
  return {
    titleKey: `tours.${tour.id}.${step.anchor}.title`,
    bodyKey: `tours.${tour.id}.${step.anchor}.body`,
  };
}

/** The i18n key for the tour's own name, as the settings list shows it. */
export function tourNameKey(tour: ITour): string {
  return `tours.${tour.id}.name`;
}

/**
 * Segment-aware, so `/workspaces/new` would resolve to a `/workspaces` tour while
 * `/settings` never resolves to a tour registered on `/compliance/settings`.
 * Lifted deliberately from `Layout.nav.ts`'s `isActivePath`, which is the same
 * question about the same paths; copying six lines beats a cross-feature import
 * of the nav module into help.
 */
function matchesRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

/** The tour for a route, deepest match first. Null when the screen has none. */
export function findTourForRoute(pathname: string, tours: readonly ITour[] = TOURS): ITour | null {
  const matches = tours
    .filter((tour) => matchesRoute(pathname, tour.route))
    .sort((a, b) => b.route.length - a.route.length);
  return matches[0] ?? null;
}

/**
 * The tour with this id, or null.
 *
 * NULL IS THE POINT. A stored progress entry can name a tour that was renamed
 * or removed (the server keeps whatever id it was handed and has no registry
 * to check it against), so every consumer of stored progress resolves through
 * here and simply skips what comes back null. That is the client half of the
 * tolerant read; the server half is `TourProgressService.resolveTours`.
 */
export function getTourById(id: string, tours: readonly ITour[] = TOURS): ITour | null {
  return tours.find((tour) => tour.id === id) ?? null;
}
