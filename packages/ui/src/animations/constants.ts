import type { Variants, Transition } from 'framer-motion';

/**
 * The motion scale.
 *
 * Tuned for a dense business app that people read for eight hours a day, which is a
 * different problem from a landing page. Motion here has one job: to explain
 * that something arrived, left, or changed place. Anything a user will see four
 * hundred times has to be over before it registers as an event.
 *
 * The three numbers that decide everything:
 *
 * - **Distance** 4 to 8px. Far enough to read as arriving from somewhere,
 *   short enough that it never looks like the layout is settling.
 * - **Duration** 120 to 200ms, ceiling 250ms. Below ~100ms motion reads as a
 *   jump; above ~250ms the user is waiting for the interface.
 * - **Scale** 0.98 to 1. A scale step is a hint of depth, not a zoom.
 *
 * Easing is directional: things arriving decelerate (`easeOut`), things leaving
 * accelerate away (`easeIn`). Springs are reserved for surfaces that should feel
 * physical, which here means a drawer, a sheet or a popover, and nowhere else:
 * a spring on a row or a badge is overshoot on data, and data must not wobble.
 *
 * `prefers-reduced-motion` is not handled here. CSS-driven motion carries its
 * own guard in `./classes`, and framer-driven motion asks `useReducedMotion()`
 * and renders the static form.
 */
export const durations = {
  /** Micro-feedback: hover, press, a color or shadow change. */
  fast: 0.12,
  /** The default for anything the user just triggered. */
  base: 0.16,
  /** An entrance that also travels: a popover, a dropdown, a row. */
  moderate: 0.2,
  /** The ceiling. A drawer or a sheet crossing the viewport, nothing else. */
  slow: 0.25,
} as const;

/** Travel distances, in pixels. Never more than a row's worth of movement. */
export const distances = {
  /** A hint of direction, for things that are essentially in place already. */
  nudge: 4,
  /** The default entrance offset. */
  step: 6,
  /** The most a menu or popover moves. */
  travel: 8,
} as const;

/**
 * Stagger for a freshly loaded list. Capped deliberately: at 12 rows the last
 * one starts 216ms in, and a 100-row table that shimmered top to bottom would
 * be unusable. Rows past the cap arrive with the cap's delay.
 */
export const stagger = {
  step: 0.018,
  maxIndex: 12,
} as const;

/** The delay for row `index` in a staggered list, in seconds. */
export function staggerDelay(index: number): number {
  return Math.min(index, stagger.maxIndex) * stagger.step;
}

const easeOut = [0, 0, 0.2, 1] as const;
const easeIn = [0.4, 0, 1, 1] as const;
const easeInOut = [0.4, 0, 0.2, 1] as const;

export const transitions = {
  /** Hover, press, and anything that only changes color. */
  fast: { duration: durations.fast, ease: easeOut },
  /** The default. */
  base: { duration: durations.base, ease: easeOut },
  /** Arriving: decelerates into place. */
  enter: { duration: durations.moderate, ease: easeOut },
  /** Leaving: accelerates away, and shorter than the entrance. */
  exit: { duration: durations.base, ease: easeIn },
  /** Something moving between two places it already occupied. */
  move: { duration: durations.moderate, ease: easeInOut },
  /**
   * The only spring in the system, for panels that should feel physical.
   * Critically damped on purpose: it settles without overshoot, because an
   * overshooting drawer throws the rows behind it out of alignment twice.
   */
  panel: { type: 'spring', stiffness: 320, damping: 34, mass: 0.9 },
} satisfies Record<string, Transition>;

export const animationVariants = {
  /** Content swapping in place: skeleton to rows, empty state to content. */
  fadeIn: {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: transitions.base },
    exit: { opacity: 0, transition: transitions.exit },
  },
  /** A surface that owns a point on screen: a popover, a menu, a dialog. */
  scaleIn: {
    initial: { opacity: 0, scale: 0.98 },
    animate: { opacity: 1, scale: 1, transition: transitions.enter },
    exit: { opacity: 0, scale: 0.98, transition: transitions.exit },
  },
  /** A row, a card, or a toast arriving from below. */
  slideUp: {
    initial: { opacity: 0, y: distances.step },
    animate: { opacity: 1, y: 0, transition: transitions.enter },
    exit: { opacity: 0, y: distances.nudge, transition: transitions.exit },
  },
  /** Anything anchored under its trigger: a dropdown, a select, a tooltip. */
  slideDown: {
    initial: { opacity: 0, y: -distances.step },
    animate: { opacity: 1, y: 0, transition: transitions.enter },
    exit: { opacity: 0, y: -distances.nudge, transition: transitions.exit },
  },
  /** A right-edge panel. Uses the panel spring, not a duration. */
  panelRight: {
    initial: { opacity: 0, x: distances.travel },
    animate: { opacity: 1, x: 0, transition: transitions.panel },
    exit: { opacity: 0, x: distances.travel, transition: transitions.exit },
  },
} satisfies Record<string, Variants>;

export type AnimationVariant = keyof typeof animationVariants;
export type TransitionPreset = keyof typeof transitions;
