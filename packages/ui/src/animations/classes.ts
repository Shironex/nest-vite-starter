/**
 * The CSS half of the motion system: Tailwind class strings for motion
 * that a stylesheet can drive on its own.
 *
 * CSS FIRST, FRAMER SECOND. Everything an overlay, a row or a hover needs is a
 * keyframe or a transition, and those cost zero runtime bytes and zero React
 * work. `framer-motion` is reserved for the two things CSS genuinely cannot do:
 * an element that has to travel between two DOM positions (the tab underline)
 * and an element that has to finish animating after React would have unmounted
 * it (a removed row). Those live in `./constants`.
 *
 * VALUES COME FROM `./constants`. `duration-150` / `duration-200` are the `base`
 * and `moderate` steps; `slide-*-1` is 4px and `slide-*-2` is 8px against the
 * `--spacing` ramp, which is `nudge` and `travel`; `zoom-*-98` is the 0.98 scale
 * step. The two files have to be read together, so keep them in step.
 *
 * REDUCED MOTION IS PART OF EVERY STRING, not a separate opt-in. `animate-none!`
 * rather than a shortened duration: Radix `Presence` treats a computed
 * `animation-name: none` as "nothing to wait for" and unmounts immediately, so
 * an exit still completes with reduced motion on. A shortened animation would
 * still move the pixels, which is the thing being asked not to happen.
 */

/**
 * A scrim, or any plain crossfade. Opacity only, so nothing travels.
 */
export const MOTION_FADE_CLASS =
  'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-150 motion-reduce:animate-none!';

/**
 * A centered surface: a dialog, an alert. Fades and takes the 0.98 scale step,
 * which reads as depth rather than as a zoom.
 */
export const MOTION_DIALOG_CLASS =
  'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-98 data-[state=open]:duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-98 data-[state=closed]:duration-150 motion-reduce:animate-none!';

/**
 * A surface anchored to a trigger: a popover, a dropdown, a select, a tooltip.
 * Slides 4px out of the trigger it belongs to, so the direction says where it
 * came from.
 */
export const MOTION_ANCHORED_CLASS =
  'data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-98 data-[state=open]:duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-98 data-[state=closed]:duration-150 motion-reduce:animate-none!';

/**
 * An edge panel: a sheet, the mobile sidebar. The one place a full-distance
 * slide is right, because the panel genuinely comes from off screen. Held to
 * the 250ms ceiling on the way in and shorter on the way out.
 */
export const MOTION_PANEL_CLASS =
  'data-[state=open]:animate-in data-[state=open]:duration-250 data-[state=closed]:animate-out data-[state=closed]:duration-200 motion-reduce:animate-none!';

/**
 * A row or card arriving on first paint. Pair with `staggerDelay()` from
 * `./constants` for a list, and cap the stagger there: a hundred rows arriving
 * one after another is a shimmer, not an explanation.
 */
export const MOTION_ROW_ENTER_CLASS =
  'animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none!';

/**
 * Content swapping in place where nothing should move: skeleton to rows, an
 * empty state to content.
 */
export const MOTION_CROSSFADE_CLASS =
  'animate-in fade-in-0 duration-200 motion-reduce:animate-none!';

/**
 * Press feedback on an interactive surface: the 0.98 scale step, on the way
 * down only. The surface supplies its own transition (`Button` already has
 * `transition-all`), because declaring one here would land in the same
 * tailwind-merge group and silently drop the color transition next to it.
 */
export const MOTION_PRESS_CLASS = 'active:scale-98 motion-reduce:active:scale-100';

/**
 * A width, height or position the layout animates between: the sidebar rail,
 * a collapsing section. Never applied to anything holding text a user is
 * reading.
 */
export const MOTION_LAYOUT_CLASS = 'duration-200 ease-out motion-reduce:transition-none';
