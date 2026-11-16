/**
 * The shape of a guided tour.
 *
 * A tour is DATA, not choreography. There is deliberately no room here for a
 * per-screen callback, a bespoke transition or an imperative escape hatch: the
 * owner wants a tour on every screen, so what matters is that tour number nine
 * costs one file, one registry line and two locale blocks. Anything a single
 * screen could express here is a thing every future screen would have to be
 * read for.
 */

/** Which side of the anchor the popover prefers. driver.js collides it away if it does not fit. */
export type TourStepSide = 'top' | 'right' | 'bottom' | 'left';

/** Where along that side the popover sits. */
export type TourStepAlign = 'start' | 'center' | 'end';

export interface ITourStep {
  /**
   * The value of the `data-tour` attribute on the element this step points at.
   *
   * An ATTRIBUTE, never a class and never DOM structure. That is the whole
   * difference between a tour that survives a restyle and one that breaks the
   * first time a `div` is rewritten, and it is why the anchor is a bare name
   * here rather than a selector: a caller cannot smuggle `.some-class` in.
   *
   * It doubles as the copy key. `tours.<tourId>.<anchor>.title` and `.body`
   * are DERIVED, so an author never writes a key and can never typo one apart
   * from its step. `Help.catalog.test.ts` asserts every derived key resolves in
   * both languages.
   */
  readonly anchor: string;
  readonly side?: TourStepSide;
  readonly align?: TourStepAlign;
}

export interface ITour {
  /** Kebab-case, matches `tourIdSchema`, and is the key this tour persists under. */
  readonly id: string;
  /**
   * The route prefix this tour belongs to. Matched the same way the sidebar
   * matches nav entries: segment-aware, deepest match wins, so `/workspaces`
   * covers `/workspaces/new` (where the list is still mounted underneath the
   * create sheet) without `/settings` ever matching `/compliance/settings`.
   */
  readonly route: string;
  /**
   * Bump when the tour's steps change materially. Stored with the completion
   * so the "re-offer a changed tour" decision can be revisited later without a
   * backfill. Nothing re-offers on it today, on purpose: a copy tweak should
   * not re-interrupt everyone.
   */
  readonly version: number;
  readonly steps: readonly ITourStep[];
}

/** How a tour ended. */
export type TourOutcome =
  /** Walked to the last step and pressed the done button. */
  | 'completed'
  /** Closed, escaped, or clicked away from. The user answered; do not re-offer. */
  | 'dismissed'
  /**
   * Never started, because not one of its anchors reached the DOM. Records
   * nothing: the user was not shown anything, so there is nothing they have
   * seen. Pointing a spotlight at nothing is the failure this value prevents.
   */
  | 'unavailable';

/** Everything the engine renders, already translated. */
export interface ITourCopy {
  readonly steps: readonly { readonly title: string; readonly body: string }[];
  readonly next: string;
  readonly previous: string;
  readonly done: string;
  readonly close: string;
  /** `{{current}}` / `{{total}}` placeholders, expanded by driver.js. */
  readonly progress: string;
}
