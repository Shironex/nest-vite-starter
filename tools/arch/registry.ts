/*
 * The hand-kept half of the module map.
 *
 * Everything else on the generated page is derived: file counts, fan-in,
 * fan-out and every cross-module edge come from reading the tree, so they
 * cannot drift. A PURPOSE cannot be derived. One sentence saying what a module
 * is for is the only part of an architecture page worth reading, and it is
 * exactly the part a generator cannot write.
 *
 * So it lives here, in code, and a module or feature with no entry fails
 * `arch-map-fresh`. That failure is the point: a new directory stops the build
 * until somebody says what it is for, which is the moment they know.
 *
 * Keep each line to one sentence of intent. What a module CONTAINS belongs on
 * the generated page; what it is FOR belongs here.
 */

/** Purpose lines keyed by directory name. */
export type IPurposeMap = Readonly<Record<string, string>>;

export interface IPurposeRegistry {
  readonly apiModules: IPurposeMap;
  readonly webFeatures: IPurposeMap;
}

/** `apps/api/src/modules/*`. */
const API_MODULE_PURPOSES: IPurposeMap = {
  audit: 'Append-only record of who changed what, written by every mutating service.',
  auth: 'May you enter: credentials, sessions, 2FA and the guards.',
  'data-export':
    'GDPR account export: gathers everything the api holds about one account into an archive.',
  health: 'Liveness and readiness probes for the container platform.',
  logger: 'Structured logging and request-scoped log context.',
  mail: 'Transactional email: templates, the queue and the provider adapter.',
  user: 'The account lifecycle: profile, roles, disabling, deletion and the purge sweep.',
};

/** `apps/web/src/features/*`. */
const WEB_FEATURE_PURPOSES: IPurposeMap = {
  admin: 'User management: roles, lockout, two-factor reset, disabling and deletion.',
  audit: 'Audit log browser with filters and per-entry detail.',
  auth: 'Sign in, register, verify, reset password and the Turnstile challenge.',
  dashboard: 'The authenticated landing page and its widgets.',
  landing: 'The public marketing page.',
  layout: 'Authenticated app shell: sidebar, top bar and user menu.',
  settings: 'Profile, password, sessions, GDPR export, theme and account deletion.',
  shared: 'Components used by more than one domain.',
  'two-factor': 'TOTP enrollment, the challenge screen and recovery codes.',
};

export const PURPOSES: IPurposeRegistry = {
  apiModules: API_MODULE_PURPOSES,
  webFeatures: WEB_FEATURE_PURPOSES,
};
