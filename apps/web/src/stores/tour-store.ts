import { create } from 'zustand';

/**
 * A pending "replay this tour" request, handed from wherever it was asked for
 * to the launcher that can actually run it.
 *
 * WHY A STORE AND NOT A CALL. The settings list can offer a replay of a tour
 * whose screen is not the screen the user is on, so the request has to survive
 * a route change: settings sets the id and navigates, the launcher mounted in
 * the app shell picks it up when the target screen renders its anchors. The
 * only alternative that keeps the state is a search param, which would put a
 * tour id in a shareable URL and re-run the tour on every back button.
 *
 * WHY IT LIVES IN `stores/` AND NOT IN THE HELP FEATURE. Exactly the reasoning
 * `topbar-store` records: `no-cross-feature-imports` forbids one feature
 * importing another's runtime code in either direction, and the requester
 * (`settings`) and the runner (the launcher composed into the shell) are in
 * different domains. A store is the shared module both are allowed to depend
 * on.
 *
 * The request is CLEARED BEFORE the tour starts, not after. A tour that throws
 * or is closed instantly must not leave a request behind that re-arms on the
 * next render.
 */
interface ITourRequestState {
  /** The tour id waiting to be replayed, or null when nothing is pending. */
  pendingTourId: string | null;
}

interface ITourRequestActions {
  requestTour: (tourId: string) => void;
  clearTourRequest: () => void;
}

export const useTourRequestStore = create<ITourRequestState & ITourRequestActions>((set) => ({
  pendingTourId: null,
  requestTour: (tourId) => {
    set({ pendingTourId: tourId });
  },
  clearTourRequest: () => {
    set({ pendingTourId: null });
  },
}));
