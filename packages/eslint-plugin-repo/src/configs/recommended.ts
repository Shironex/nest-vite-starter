/*
 * Recommended severities for consumers of this plugin. The repo's own
 * enablement lives in packages/eslint-config/nestjs.js, where these rules are
 * path-scoped to apps/api src. This map is the documented default set for the
 * rules that still live here; every other former rule, the Prisma tenancy and
 * transaction family included, was swapped for its published
 * @noctcore/eslint-plugin-* equivalent.
 */
export const recommendedRules = {
  // BullMQ / queue conventions. The repo enables these scoped to apps/api
  // non-spec source in packages/eslint-config/nestjs.js.
  'repo/processor-must-extend-traced-worker-host': 'error',
  'repo/queue-add-must-wrap-job-context': 'error',
  'repo/job-name-must-be-constant': 'error',
  // Frontend rule, path-scoped to the app and component packages in
  // packages/eslint-config/react-architecture.js.
  'repo/no-native-date-input': 'off',
  // Frontend rule, path-scoped to the web app's feature folders in
  // packages/eslint-config/react-architecture.js for the same reason.
  'repo/effect-fired-mutation-must-bind-callbacks': 'off',
  // Frontend rule, path-scoped to the web app in packages/eslint-config/react-architecture.js.
  'repo/trpc-invalidate-with-path-key': 'off',
} as const;
