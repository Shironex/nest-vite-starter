/**
 * Thin static-import bridge for the Sentry SDK. Loaded ONLY via dynamic
 * import from error-reporting.ts, never statically, so it becomes its own
 * lazy chunk that fetches only when reporting is enabled.
 *
 * Why not `import('@sentry/react')` directly? A dynamic namespace import
 * reifies every export of the package (session replay, feedback, tracing
 * integrations) into the lazy chunk, roughly tripling it. Re-exporting just
 * the two functions the facade needs lets the bundler tree-shake the chunk
 * down to the error-monitoring core.
 */
export { init, captureException } from '@sentry/react';
