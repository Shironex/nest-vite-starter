import { captureException } from '@/lib/error-reporting';
import { tourAnchorSelector } from './Help.tours';
import type { ITour, ITourCopy, ITourStep, TourOutcome } from './Help.types';

/**
 * The tour engine: everything the library does not do.
 *
 * driver.js buys a spotlight cutout that tracks an element through scroll and
 * resize, popover placement with collision handling, arrow/Escape keys and a
 * focus trap between the popover and the highlighted element. It is the small
 * half. This file owns the rest: lazy loading so first paint pays nothing,
 * resolving anchors that have not mounted, deciding a tour cannot run at all,
 * branching on reduced motion BEFORE the choreography, and restoring focus to
 * whatever started the tour.
 *
 * It never touches i18next. Copy arrives already translated in `ITourCopy`, so
 * the engine is a pure function of (tour, copy, DOM) and can be tested without
 * a React tree or a locale.
 */

/**
 * How long to wait for an anchor that is not in the DOM yet.
 *
 * Long enough for a route transition, a suspended chunk and a first query to
 * settle; short enough that a user who pressed a help button is not staring at
 * nothing. Every anchor is waited for in PARALLEL, so this is the whole
 * pre-flight budget, not a per-step one.
 */
export const ANCHOR_TIMEOUT_MS = 2_000;

/**
 * How long driver.js itself waits for a step's element at step entry, on top of
 * the pre-flight above. The pre-flight answers "can this tour run at all"; this
 * covers an element that was present a moment ago and got re-rendered away
 * between the tour starting and the step being reached.
 */
const STEP_WAIT_MS = 800;

/**
 * `prefers-reduced-motion: reduce`, read ONCE per tour.
 *
 * The branch happens here, before any choreography is configured, rather than
 * inside it: the answer is `animate: false`, not a shorter duration. A
 * shortened animation still moves the pixels, and moving the pixels is the
 * thing the setting asks not to happen.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Resolve `selector`, waiting up to `timeoutMs` for it to appear.
 *
 * A `MutationObserver` rather than a poll, so a node that mounts 30 ms in is
 * spotlighted 30 ms in rather than at the next tick of somebody's interval.
 * Resolves `null` on timeout: a missing anchor is an ordinary outcome (the
 * screen renders a table only when there are rows), not an error, and the
 * caller decides what to do about it.
 */
export function waitForAnchor(
  selector: string,
  timeoutMs: number = ANCHOR_TIMEOUT_MS,
): Promise<Element | null> {
  const existing = document.querySelector(selector);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (element: Element | null) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      window.clearTimeout(timer);
      resolve(element);
    };

    const observer = new MutationObserver(() => {
      const found = document.querySelector(selector);
      if (found) finish(found);
    });
    const timer = window.setTimeout(() => {
      finish(null);
    }, timeoutMs);

    observer.observe(document.body, { childList: true, subtree: true });
  });
}

/**
 * The steps of `tour` whose anchors reached the DOM, with their original index
 * so the copy stays aligned after a skip.
 *
 * A step whose anchor never appears is DROPPED and the tour carries on. It is
 * never spotlighted at nothing and the tour is never aborted halfway, because
 * both of those are worse than a tour that is one step shorter than it was
 * written to be. The drop is reported to Sentry with the tour id and the
 * anchor: a step that silently stops appearing is how a tour rots into a lie,
 * and nobody notices from the inside.
 */
export async function resolveSteps(
  tour: ITour,
  timeoutMs: number = ANCHOR_TIMEOUT_MS,
): Promise<Array<{ step: ITourStep; index: number }>> {
  const found = await Promise.all(
    tour.steps.map((step) => waitForAnchor(tourAnchorSelector(step.anchor), timeoutMs)),
  );

  const resolved: Array<{ step: ITourStep; index: number }> = [];
  tour.steps.forEach((step, index) => {
    if (found[index]) {
      resolved.push({ step, index });
      return;
    }
    captureException(new Error(`Tour anchor never appeared: ${tour.id}/${step.anchor}`), {
      extra: { tourId: tour.id, anchor: step.anchor, timeoutMs },
    });
  });

  return resolved;
}

/**
 * Whether a tour has anything to show right now.
 *
 * Used to decide whether the screen gets a help control at all: offering help
 * that cannot run is worse than offering none. Deliberately the same
 * resolution the run path uses, so the button and the tour can never disagree.
 */
export async function canRunTour(tour: ITour, timeoutMs?: number): Promise<boolean> {
  return (await resolveSteps(tour, timeoutMs)).length > 0;
}

/**
 * Is a modal dialog on screen right now?
 *
 * A tour and a modal are both overlays that take the whole screen, and they do
 * not compose: driver.js masks everything outside its spotlight, so a tour that
 * begins while a dialog is open makes the dialog unusable. Its fields resolve
 * in the DOM and simply never accept a click, which reads to the user as a
 * frozen form rather than as a tour they could dismiss.
 *
 * This is a real defect, not a test artifact: it was found by an e2e run whose
 * click on a draft form field retried 338 times against a live tour overlay.
 *
 * Matches what Radix actually renders. `Dialog` and `AlertDialog` both set
 * `role` and `data-state="open"` on their content node, so this needs no
 * cooperation from every dialog in the app, which is the point: a guard that
 * each caller has to remember is a guard that will be forgotten.
 */
export function isModalOpen(): boolean {
  if (typeof document === 'undefined') return false;
  return (
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
    ) !== null
  );
}

/**
 * Load driver.js and its stylesheet.
 *
 * THE LAZY IMPORT IS THE WHOLE BUNDLE STORY. `apps/web` gates first paint at
 * 225 kB, and the standing lesson of that gate is not to ship bytes most
 * sessions never render. Help is help: nothing here reaches the entry graph,
 * so the engine and its CSS cost exactly zero against that budget and arrive
 * only when somebody asks for a tour.
 */
async function loadDriver() {
  const [{ driver }] = await Promise.all([
    import('driver.js'),
    import('driver.js/dist/driver.css'),
  ]);
  return driver;
}

export interface IRunTourOptions {
  /**
   * The element focus returns to when the tour ends. A tour that leaves focus
   * on `<body>` has silently reset a keyboard user to the top of the page.
   */
  readonly origin?: Element | null;
  /** The pre-flight anchor budget. Defaults to `ANCHOR_TIMEOUT_MS`. */
  readonly anchorTimeoutMs?: number;
}

/** Restore focus to `element` if it is still in the document. */
function restoreFocus(element: Element | null): void {
  if (element instanceof HTMLElement && element.isConnected) element.focus();
}

/**
 * Run one tour to its end and resolve with how it ended.
 *
 * Focus: driver.js focuses the first control in the popover on every step and
 * traps Tab between the popover and the highlighted element, so a keyboard user
 * can walk and leave a tour with no help from us. What it does not reliably do
 * is put focus back where the tour STARTED, so the origin element is captured
 * before the first step and refocused on teardown: a tour that leaves focus
 * on `<body>` has silently reset a keyboard user to the top of the page.
 *
 * `options.origin` is the element focus returns to, and the CALLER should pass
 * it. Reading `document.activeElement` here is too late in the one case that
 * matters: the launcher disables itself while a tour runs, and a disabled
 * button is blurred, so by the time the engine looks the button that started
 * the tour has already stopped being the active element. The default is a
 * best-effort fallback for a caller that does not care.
 *
 * `options.anchorTimeoutMs` is the pre-flight budget, exposed so tests do not
 * have to spend two real seconds proving that a missing anchor is skipped.
 */
export async function runTour(
  tour: ITour,
  copy: ITourCopy,
  options: IRunTourOptions = {},
): Promise<TourOutcome> {
  const origin = options.origin ?? document.activeElement;
  const resolved = await resolveSteps(tour, options.anchorTimeoutMs ?? ANCHOR_TIMEOUT_MS);
  if (resolved.length === 0) return 'unavailable';

  const driver = await loadDriver();
  const animate = !prefersReducedMotion();

  return new Promise<TourOutcome>((resolve) => {
    // 'dismissed' is the default because every path that is not the done
    // button (Escape, the close control, a click on the overlay) is the
    // user saying they have seen enough. Both answers suppress the auto-start.
    let outcome: TourOutcome = 'dismissed';

    /*
     * Declared before the instance because `onDestroyed` closes over it. A tour
     * that destroys synchronously inside `drive()` would otherwise reach this
     * binding in its temporal dead zone and throw instead of tearing down.
     */
    let modalWatch: MutationObserver | null = null;

    const instance = driver({
      animate,
      // Redundant with the pre-flight for an anchor that never mounts, and the
      // point for one that unmounts mid-tour: driver skips it and moves on
      // rather than spotlighting a stale rectangle.
      skipMissingElement: true,
      waitForElement: STEP_WAIT_MS,
      allowKeyboardControl: true,
      showProgress: true,
      progressText: copy.progress,
      nextBtnText: copy.next,
      prevBtnText: copy.previous,
      doneBtnText: copy.done,
      popoverClass: 'starter-tour',
      onPopoverRender: (popover) => {
        // driver.js writes the close control with no accessible name at all, so
        // a screen reader announces an unlabeled button as the only way out.
        popover.closeButton.setAttribute('aria-label', copy.close);
        // The popover replaces the page's reading context on every step; without
        // this a screen reader announces the focus move and nothing else.
        popover.wrapper.setAttribute('role', 'dialog');
        popover.wrapper.setAttribute('aria-modal', 'true');
        popover.wrapper.setAttribute('aria-labelledby', popover.title.id || '');
      },
      // Overriding onDoneClick/onCloseClick REPLACES driver's own teardown for
      // those two buttons, so each has to destroy explicitly. `destroy()` skips
      // onDestroyStarted, so there is no re-entry.
      onDoneClick: () => {
        outcome = 'completed';
        instance.destroy();
      },
      onCloseClick: () => {
        outcome = 'dismissed';
        instance.destroy();
      },
      onDestroyed: () => {
        modalWatch?.disconnect();
        // Deferred by one task on purpose. driver.js's own teardown focuses the
        // element that was active when the last step was entered, and it does
        // that AFTER calling this hook, so a synchronous restore here is
        // silently overwritten whenever the caller's origin and driver's guess
        // disagree, which is precisely when the restore matters.
        window.setTimeout(() => {
          restoreFocus(origin);
        }, 0);
        resolve(outcome);
      },
      steps: resolved.map(({ step, index }) => ({
        element: tourAnchorSelector(step.anchor),
        popover: {
          title: copy.steps[index]?.title ?? '',
          description: copy.steps[index]?.body ?? '',
          // Spread rather than assigned: `exactOptionalPropertyTypes` is on, so
          // an explicit `side: undefined` is not the same thing as "let driver
          // place it", and driver.js only auto-places when the key is absent.
          ...(step.side ? { side: step.side } : {}),
          ...(step.align ? { align: step.align } : {}),
        },
      })),
    });

    instance.drive();

    /*
     * A modal that opens mid-tour ends the tour.
     *
     * driver.js masks everything outside its spotlight, so a dialog opened while
     * a tour is running is visible but not operable: its fields resolve, look
     * enabled, and silently refuse every click. The user sees a frozen form, not
     * a tour they could dismiss, and the tour's own popover is pointing at
     * something the dialog now covers anyway.
     *
     * Ending rather than pausing, because the user has visibly moved on: they
     * opened a dialog. The outcome stays 'dismissed', which is already the
     * default for every non-done exit, so the tour is recorded as answered and
     * does not ambush them again on the next visit.
     *
     * Found by an e2e run whose click on a draft form field retried 338 times
     * against a live overlay. It is a real defect, not a test artifact: the same
     * sequence, land on a screen and open its create dialog, does it to a
     * person.
     */
    modalWatch =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => {
            if (!isModalOpen()) return;
            outcome = 'dismissed';
            instance.destroy();
          });
    modalWatch?.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-state', 'role'],
    });
  });
}
