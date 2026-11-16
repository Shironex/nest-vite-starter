/**
 * The landing page is entirely static: every section owns its own view hook,
 * so the composer has no state of its own. This bucket exists to satisfy the
 * component-folder convention and gives the page somewhere to grow if the
 * marketing site later needs shared state (an experiment flag, a scroll spy).
 */
export function useLandingPage(): Record<string, never> {
  return {};
}
