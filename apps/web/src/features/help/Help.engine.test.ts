import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANCHOR_TIMEOUT_MS,
  canRunTour,
  isModalOpen,
  prefersReducedMotion,
  resolveSteps,
  runTour,
  waitForAnchor,
} from './Help.engine';
import type { ITour, ITourCopy } from './Help.types';

const captureException = vi.hoisted(() => vi.fn());
vi.mock('@/lib/error-reporting', () => ({ captureException }));

/** The last config driver.js was constructed with, and the fake instance. */
const driverState = vi.hoisted(() => ({
  config: undefined as Record<string, unknown> | undefined,
  drive: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock('driver.js', () => ({
  driver: (config: Record<string, unknown>) => {
    driverState.config = config;
    return {
      drive: driverState.drive,
      destroy: driverState.destroy,
    };
  },
}));
vi.mock('driver.js/dist/driver.css', () => ({}));

const TOUR: ITour = {
  id: 'demo',
  route: '/demo',
  version: 1,
  steps: [{ anchor: 'first' }, { anchor: 'second', side: 'top', align: 'end' }],
};

const COPY: ITourCopy = {
  steps: [
    { title: 'First', body: 'First description' },
    { title: 'Second', body: 'Second description' },
  ],
  next: 'Next',
  previous: 'Back',
  done: 'Done',
  close: 'Close the tour',
  progress: 'Step {{current}} of {{total}}',
};

function anchor(name: string): HTMLElement {
  const node = document.createElement('div');
  node.setAttribute('data-tour', name);
  document.body.append(node);
  return node;
}

beforeEach(() => {
  document.body.innerHTML = '';
  driverState.config = undefined;
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('waitForAnchor', () => {
  it('resolves an anchor that is already in the DOM without waiting', async () => {
    const node = anchor('first');

    await expect(waitForAnchor('[data-tour="first"]')).resolves.toBe(node);
  });

  /**
   * The case the whole helper exists for: driver.js evaluates a step's element
   * at step entry, which covers "not in the DOM when the tour was defined" but
   * not "mounts 300 ms after the tour started". A MutationObserver resolves it
   * the moment it appears rather than at the next tick of somebody's interval.
   */
  it('resolves an anchor that mounts late', async () => {
    const pending = waitForAnchor('[data-tour="late"]');
    setTimeout(() => anchor('late'), 5);

    await expect(pending).resolves.toBeInstanceOf(HTMLElement);
  });

  it('resolves null on timeout rather than throwing, because a missing anchor is ordinary', async () => {
    await expect(waitForAnchor('[data-tour="never"]', 10)).resolves.toBeNull();
  });
});

describe('resolveSteps', () => {
  it('keeps the original index, so a skip cannot shift the copy onto the wrong step', async () => {
    anchor('second');

    const resolved = await resolveSteps(TOUR, 10);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.index).toBe(1);
    expect(resolved[0]?.step.anchor).toBe('second');
  });

  /**
   * A step that silently stops appearing is how a tour rots into a lie, and
   * nobody notices from the inside. The drop is reported with the tour id and
   * the anchor so it is findable from the outside.
   */
  it('reports a dropped step with its tour id and anchor', async () => {
    anchor('first');

    await resolveSteps(TOUR, 10);

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('demo/second') }),
      expect.objectContaining({ extra: expect.objectContaining({ anchor: 'second' }) }),
    );
  });
});

describe('canRunTour', () => {
  it('is true while at least one anchor is present', async () => {
    anchor('second');

    await expect(canRunTour(TOUR, 10)).resolves.toBe(true);
  });

  it('is false when no anchor is present, which is what hides the help button', async () => {
    await expect(canRunTour(TOUR, 10)).resolves.toBe(false);
  });
});

describe('isModalOpen', () => {
  it('is false on a screen with no dialog', () => {
    expect(isModalOpen()).toBe(false);
  });

  it('is true while a Radix dialog is open, which is what suppresses the auto-start', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('data-state', 'open');
    document.body.append(dialog);

    expect(isModalOpen()).toBe(true);
  });

  it('is true for an alertdialog too, since a confirm is just as blocking', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('data-state', 'open');
    document.body.append(dialog);

    expect(isModalOpen()).toBe(true);
  });

  it('is false once the dialog closes, so the next visit can still be offered the tour', () => {
    // Radix keeps the node mounted through its exit animation and flips the
    // state, so presence alone would keep the tour suppressed after the dialog
    // was gone from the screen.
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('data-state', 'closed');
    document.body.append(dialog);

    expect(isModalOpen()).toBe(false);
  });
});

describe('runTour', () => {
  it('does not start, and reports unavailable, when no anchor is on the screen', async () => {
    await expect(
      runTour({ ...TOUR, steps: [{ anchor: 'never' }] }, COPY, { anchorTimeoutMs: 10 }),
    ).resolves.toBe('unavailable');

    expect(driverState.drive).not.toHaveBeenCalled();
  });

  it('drives only the steps whose anchors resolved, with their own copy', async () => {
    anchor('second');
    const running = runTour(TOUR, COPY, { anchorTimeoutMs: 10 });
    await vi.waitFor(() => {
      expect(driverState.config).toBeDefined();
    });

    const steps = driverState.config?.steps as Array<{ popover: { title: string } }>;
    expect(steps).toHaveLength(1);
    expect(steps[0]?.popover.title).toBe('Second');

    (driverState.config?.onDestroyed as () => void)();
    await running;
  });

  it('resolves completed when the done button ends the tour', async () => {
    anchor('first');
    const running = runTour(TOUR, COPY, { anchorTimeoutMs: 10 });
    await vi.waitFor(() => {
      expect(driverState.config).toBeDefined();
    });

    (driverState.config?.onDoneClick as () => void)();
    expect(driverState.destroy).toHaveBeenCalled();
    (driverState.config?.onDestroyed as () => void)();

    await expect(running).resolves.toBe('completed');
  });

  it('resolves dismissed when the close control ends it', async () => {
    anchor('first');
    const running = runTour(TOUR, COPY, { anchorTimeoutMs: 10 });
    await vi.waitFor(() => {
      expect(driverState.config).toBeDefined();
    });

    (driverState.config?.onCloseClick as () => void)();
    (driverState.config?.onDestroyed as () => void)();

    await expect(running).resolves.toBe('dismissed');
  });

  /**
   * Escape and a click on the overlay both go straight to driver's own
   * teardown, so neither reaches onCloseClick. They must still read as an
   * answer: dismissed is the default outcome precisely so an escaped tour is
   * not re-offered forever.
   */
  it('reads an escape, which never reaches onCloseClick, as dismissed', async () => {
    anchor('first');
    const running = runTour(TOUR, COPY, { anchorTimeoutMs: 10 });
    await vi.waitFor(() => {
      expect(driverState.config).toBeDefined();
    });

    (driverState.config?.onDestroyed as () => void)();

    await expect(running).resolves.toBe('dismissed');
  });

  /**
   * The origin is PASSED IN, not read here: the launcher disables itself while
   * a tour runs, a disabled button is blurred, and reading `activeElement` at
   * this point would find `<body>` in exactly the case that matters.
   */
  it('restores focus to the origin the caller named', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    anchor('first');

    const running = runTour(TOUR, COPY, { anchorTimeoutMs: 10, origin: trigger });
    await vi.waitFor(() => {
      expect(driverState.config).toBeDefined();
    });
    (driverState.config?.onDestroyed as () => void)();
    await running;
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it('falls back to the active element when the caller names no origin', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    anchor('first');

    const running = runTour(TOUR, COPY, { anchorTimeoutMs: 10 });
    await vi.waitFor(() => {
      expect(driverState.config).toBeDefined();
    });
    (document.activeElement as HTMLElement | null)?.blur();
    (driverState.config?.onDestroyed as () => void)();
    await running;
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it('names the close control, which driver.js ships without an accessible name', async () => {
    anchor('first');
    const running = runTour(TOUR, COPY, { anchorTimeoutMs: 10 });
    await vi.waitFor(() => {
      expect(driverState.config).toBeDefined();
    });

    const closeButton = document.createElement('button');
    const wrapper = document.createElement('div');
    const title = document.createElement('div');
    (driverState.config?.onPopoverRender as (popover: unknown) => void)({
      closeButton,
      wrapper,
      title,
    });

    expect(closeButton.getAttribute('aria-label')).toBe('Close the tour');
    expect(wrapper.getAttribute('role')).toBe('dialog');

    (driverState.config?.onDestroyed as () => void)();
    await running;
  });

  it('keeps keyboard control on, because a tour a keyboard user cannot leave is worse than none', async () => {
    anchor('first');
    const running = runTour(TOUR, COPY, { anchorTimeoutMs: 10 });
    await vi.waitFor(() => {
      expect(driverState.config).toBeDefined();
    });

    expect(driverState.config?.allowKeyboardControl).toBe(true);

    (driverState.config?.onDestroyed as () => void)();
    await running;
  });
});

describe('reduced motion', () => {
  const stubMatchMedia = (matches: boolean) => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches,
        media: '',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  };

  it('reads the media query', () => {
    stubMatchMedia(true);

    expect(prefersReducedMotion()).toBe(true);
  });

  /**
   * The branch happens BEFORE the choreography, and the answer is `animate:
   * false`, not a shorter duration. A shortened animation still moves the
   * pixels, and moving the pixels is the thing the setting asks not to happen.
   */
  it('turns the animation off entirely rather than shortening it', async () => {
    stubMatchMedia(true);
    anchor('first');

    const running = runTour(TOUR, COPY, { anchorTimeoutMs: 10 });
    await vi.waitFor(() => {
      expect(driverState.config).toBeDefined();
    });

    expect(driverState.config?.animate).toBe(false);
    expect(driverState.config?.duration).toBeUndefined();

    (driverState.config?.onDestroyed as () => void)();
    await running;
  });

  it('animates when the user has not asked for reduced motion', async () => {
    stubMatchMedia(false);
    anchor('first');

    const running = runTour(TOUR, COPY, { anchorTimeoutMs: 10 });
    await vi.waitFor(() => {
      expect(driverState.config).toBeDefined();
    });

    expect(driverState.config?.animate).toBe(true);

    (driverState.config?.onDestroyed as () => void)();
    await running;
  });
});

describe('the pre-flight budget', () => {
  it('is a whole-tour budget, not a per-step one: every anchor is waited for in parallel', async () => {
    const started = Date.now();

    await resolveSteps({ ...TOUR, steps: [{ anchor: 'a' }, { anchor: 'b' }, { anchor: 'c' }] }, 20);

    expect(Date.now() - started).toBeLessThan(ANCHOR_TIMEOUT_MS);
  });
});
