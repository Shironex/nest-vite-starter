import { describe, expect, it } from 'vitest';
import { tourIdSchema } from '@repo/shared/schemas';
import {
  TOURS,
  findTourForRoute,
  getTourById,
  tourAnchorSelector,
  tourNameKey,
  tourStepKeys,
} from './Help.tours';
import type { ITour } from './Help.types';

describe('the tour registry', () => {
  it('gives every tour an id the wire contract accepts', () => {
    for (const tour of TOURS) {
      expect(tourIdSchema.safeParse(tour.id).success).toBe(true);
    }
  });

  it('has no duplicate ids, which would make two tours share one progress entry', () => {
    const ids = TOURS.map((tour) => tour.id);

    expect([...new Set(ids)]).toHaveLength(ids.length);
  });

  /**
   * Copy keys are DERIVED from the anchor, so two steps in one tour sharing an
   * anchor would silently share their copy. It has never been wanted and would
   * be confusing if it happened by accident.
   */
  it('has no duplicate anchors inside one tour', () => {
    for (const tour of TOURS) {
      const anchors = tour.steps.map((step) => step.anchor);
      expect([...new Set(anchors)]).toHaveLength(anchors.length);
    }
  });

  it('has at least one step in every tour, because an empty tour is not a tour', () => {
    for (const tour of TOURS) {
      expect(tour.steps.length).toBeGreaterThan(0);
    }
  });
});

describe('tourAnchorSelector', () => {
  it('selects on the data attribute, never on a class or on structure', () => {
    expect(tourAnchorSelector('workspaces-filters')).toBe('[data-tour="workspaces-filters"]');
  });
});

describe('derived copy keys', () => {
  it('keys a step by its tour and its anchor, so an author writes no key at all', () => {
    const step = { anchor: 'toolbar' };
    const tour: ITour = { id: 'demo', route: '/demo', version: 1, steps: [step] };

    expect(tourStepKeys(tour, step)).toEqual({
      titleKey: 'tours.demo.toolbar.title',
      bodyKey: 'tours.demo.toolbar.body',
    });
    expect(tourNameKey(tour)).toBe('tours.demo.name');
  });
});

describe('findTourForRoute', () => {
  const tours: readonly ITour[] = [
    { id: 'workspaces', route: '/workspaces', version: 1, steps: [{ anchor: 'a' }] },
    { id: 'settings', route: '/settings', version: 1, steps: [{ anchor: 'b' }] },
    { id: 'reminders', route: '/compliance/settings', version: 1, steps: [{ anchor: 'c' }] },
  ];

  it('matches the screen itself', () => {
    expect(findTourForRoute('/workspaces', tours)?.id).toBe('workspaces');
  });

  /**
   * `/workspaces` is a layout route: the list stays mounted underneath the
   * create sheet and the detail drawer, so its anchors are still in the DOM and
   * its tour is still the right one.
   */
  it('matches a child route, where the parent screen is still mounted', () => {
    expect(findTourForRoute('/workspaces/new', tours)?.id).toBe('workspaces');
  });

  it('is segment-aware, so /settings never claims /compliance/settings', () => {
    expect(findTourForRoute('/compliance/settings', tours)?.id).toBe('reminders');
  });

  it('prefers the deepest match', () => {
    const nested: readonly ITour[] = [
      ...tours,
      { id: 'archive', route: '/workspaces/archive', version: 1, steps: [{ anchor: 'd' }] },
    ];

    expect(findTourForRoute('/workspaces/archive', nested)?.id).toBe('archive');
  });

  it('answers null on a screen with no tour, which is how the help button stays hidden', () => {
    expect(findTourForRoute('/audit', tours)).toBeNull();
  });
});

describe('getTourById', () => {
  it('resolves a registered tour', () => {
    const first = TOURS[0];

    expect(getTourById(first?.id ?? '')?.id).toBe(first?.id);
  });

  /**
   * The client half of the tolerant read. The server stores whatever id it was
   * handed and has no registry to check it against, so stored progress can name
   * a tour that was renamed or removed. Every consumer resolves through here
   * and skips what comes back null; nothing throws and nothing renders a row
   * for a tour that no longer exists.
   */
  it('answers null for a tour id the registry no longer knows', () => {
    expect(getTourById('retired-screen')).toBeNull();
  });
});
