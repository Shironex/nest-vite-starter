'use client';

import * as React from 'react';

import { MOTION_FADE_CLASS, MOTION_PANEL_CLASS } from '@repo/ui/animations';

/**
 * Shared plumbing for the right-edge overlay convention.
 *
 * A record view opens as a drawer pinned to the right edge, and creating or
 * editing one of its sections opens a second sheet docked to the LEFT of that
 * drawer. Both panels therefore have to share the right edge, which a plain
 * `fixed right-0` panel cannot do on its own.
 *
 * The dock is a single `position: fixed`, right-anchored flex row appended to
 * `document.body`. Every panel rents a host element inside it and portals its
 * Radix dialog into that host, so the panels lay out as flex siblings instead
 * of stacking on top of each other. Layer order, the mobile fallback and which
 * layer owns the tinted scrim are all derived here, in one place.
 *
 * No provider is required: the dock is created on first use and removed when
 * the last panel leaves it.
 */

export type OverlayDockKind = 'drawer' | 'sheet';

interface IOverlayDockLayer {
  kind: OverlayDockKind;
  host: HTMLDivElement;
  /** Radix keeps a closing panel mounted through its exit animation, so
   *  presence is ref counted across the overlay and the content subtree. */
  retainCount: number;
}

interface IOverlayDockSnapshot {
  /** Bottom-most visible layer. It owns the tinted scrim so two open panels
   *  never darken the page twice. */
  baseHost: HTMLDivElement | null;
  /** Newest visible layer. Below the `sm` breakpoint only this one is shown. */
  topHost: HTMLDivElement | null;
}

const DOCK_CLASS = 'pointer-events-none fixed inset-y-0 right-0 z-50 flex items-stretch';
const HOST_CLASS = 'flex items-stretch max-sm:data-[dock-top=false]:hidden';

const EMPTY_SNAPSHOT: IOverlayDockSnapshot = { baseHost: null, topHost: null };

let dockElement: HTMLDivElement | null = null;
let layers: IOverlayDockLayer[] = [];
let snapshot: IOverlayDockSnapshot = EMPTY_SNAPSHOT;
const listeners = new Set<() => void>();

function getDock(): HTMLDivElement {
  if (dockElement) return dockElement;
  const element = document.createElement('div');
  element.setAttribute('data-slot', 'overlay-dock');
  element.className = DOCK_CLASS;
  document.body.appendChild(element);
  dockElement = element;
  return element;
}

function publish(): void {
  const sheets = layers.filter((layer) => layer.kind === 'sheet');
  const drawers = layers.filter((layer) => layer.kind === 'drawer');

  // Left to right: newest sheet, older sheets, then the drawer on the right edge.
  const ordered = [...sheets].reverse().concat(drawers);
  ordered.forEach((layer, index) => {
    layer.host.style.order = String(index);
  });

  const base = layers[0];
  const top = layers[layers.length - 1];
  const baseHost = base ? base.host : null;
  const topHost = top ? top.host : null;

  layers.forEach((layer) => {
    layer.host.dataset.dockTop = String(layer.host === topHost);
  });

  if (snapshot.baseHost !== baseHost || snapshot.topHost !== topHost) {
    snapshot = { baseHost, topHost };
  }
  listeners.forEach((listener) => {
    listener();
  });
}

/**
 * Joins the dock. A host is only in the dock while its panel is on screen:
 * Radix hides everything outside the active dialog with `aria-hidden` on mount,
 * and that pass is a one-shot walk over whatever exists at the time, so an idle
 * host parked in the dock would be marked hidden and would stay hidden when its
 * own panel later opened inside it.
 */
function retainHost(host: HTMLDivElement, kind: OverlayDockKind): void {
  const existing = layers.find((layer) => layer.host === host);
  if (existing) {
    existing.retainCount += 1;
    return;
  }
  layers = [...layers, { kind, host, retainCount: 1 }];
  getDock().appendChild(host);
  publish();
}

function releaseHost(host: HTMLDivElement): void {
  const layer = layers.find((entry) => entry.host === host);
  if (!layer) return;
  layer.retainCount -= 1;
  if (layer.retainCount > 0) return;

  layers = layers.filter((entry) => entry !== layer);
  host.remove();
  if (dockElement && dockElement.childElementCount === 0) {
    dockElement.remove();
    dockElement = null;
  }
  publish();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): IOverlayDockSnapshot {
  return snapshot;
}

function getServerSnapshot(): IOverlayDockSnapshot {
  return EMPTY_SNAPSHOT;
}

function createHostElement(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;
  const host = document.createElement('div');
  host.className = HOST_CLASS;
  host.dataset.dockTop = 'false';
  return host;
}

export interface IOverlayDockLayerState {
  /** Portal container for this panel. `null` only when there is no document. */
  host: HTMLDivElement | null;
  /** True when this is the bottom-most visible layer, which owns the scrim. */
  isBase: boolean;
  /** True when this is the newest visible layer. */
  isTop: boolean;
}

export function useOverlayDockLayer(): IOverlayDockLayerState {
  const [host] = React.useState(createHostElement);
  const state = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return {
    host,
    isBase: host !== null && state.baseHost === host,
    isTop: host !== null && state.topHost === host,
  };
}

/**
 * True while a docked panel is already dimming the page. A centered dialog
 * opened on top of one, such as a delete confirmation launched from a drawer,
 * uses this to skip its own scrim instead of darkening the page twice.
 */
export function useOverlayDockScrimActive(): boolean {
  const state = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return state.baseHost !== null;
}

export interface IOverlayDockPresenceProps {
  host: HTMLDivElement;
  kind: OverlayDockKind;
}

/**
 * Renders nothing. Mounted inside a panel's portaled subtree so the dock
 * learns when Radix actually tears the panel down, which is after the exit
 * animation rather than the moment `open` flips to false.
 */
export function OverlayDockPresence({ host, kind }: IOverlayDockPresenceProps): null {
  React.useEffect(() => {
    retainHost(host, kind);
    return () => {
      releaseHost(host);
    };
  }, [host, kind]);
  return null;
}

/**
 * Scrim. `black/45` stands in for the design scrim `rgba(11,16,32,0.45)`, which
 * has no color variable in the collection yet, and matches the existing
 * `@repo/ui` dialog and sheet overlays.
 */
export const OVERLAY_SCRIM_CLASS = 'bg-black/45';

/**
 * Fade for a scrim. Aliases the shared motion vocabulary so the dock, the Radix
 * primitives and any new surface all move on the same curve; the reduced-motion
 * guard and the reason for `animate-none!` over a shortened duration live with
 * the definition in `animations/classes.ts`.
 */
export const OVERLAY_FADE_CLASS = MOTION_FADE_CLASS;

/**
 * Slide for a right-edge panel. `MOTION_PANEL_CLASS` supplies the timing, which
 * is the one place a full-distance slide is right because the panel genuinely
 * arrives from off screen; this adds the direction.
 */
export const OVERLAY_SLIDE_RIGHT_CLASS = `${MOTION_PANEL_CLASS} data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right`;
