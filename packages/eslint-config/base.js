import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import turboPlugin from 'eslint-plugin-turbo';
import tseslint from 'typescript-eslint';
import codeQuality from '@noctcore/eslint-plugin-code-quality';
import contracts from '@noctcore/eslint-plugin-contracts';
import asyncSafety from '@noctcore/eslint-plugin-async-safety';
import security from '@noctcore/eslint-plugin-security';
import architecture from '@noctcore/eslint-plugin-architecture';

/*
 * These rules previously lived in @repo/eslint-plugin-repo; they are now the
 * published @noctcore/eslint-plugin-* equivalents (option-driven generalizations
 * of the same logic). The option objects below reproduce this repo's prior
 * defaults exactly. One subtlety: the noctcore allowlist matchers run against the
 * raw (absolute) filename, whereas the old local rules resolved to a repo-root
 * relative path first. So every allowlist glob that was NOT already anchored with
 * a leading `**\/` is anchored here, otherwise it would never match the absolute
 * path ESLint reports.
 */
const NO_PROCESS_EXIT_ALLOW_IN = [
  '**/otel.ts',
  '**/apps/api/src/main.ts',
  '**/apps/desktop/**',
  '**/packages/database/**',
  '**/tools/**',
  '**/scripts/**',
  '**/*.config.{ts,js,mjs,cjs}',
];

const NO_DIRECT_PROCESS_ENV_ALLOWED_FILES = [
  '**/otel.ts',
  '**/packages/shared/src/logger/**',
  '**/apps/api/src/modules/logger/logger.service.ts',
  '**/apps/api/src/common/observability/sentry-scrub.ts',
  // APP_TIME_ZONE has to be a value when the module loads: `@Cron({ timeZone })`
  // decorators read it at class-definition time, before any ConfigService
  // exists. Joi validates the same key at boot.
  '**/apps/api/src/common/clock/app-calendar.ts',
  '**/apps/api/test/**',
  // The web e2e harness, the counterpart of apps/api/test above. Playwright
  // specs read the same ADMIN_EMAIL / ADMIN_PASSWORD the CI seed step sets;
  // there is no Nest config module in a browser-driving harness to read them
  // through. Covers the shared support/ modules, which are not *.spec.ts and so
  // fall outside the test-file pattern below.
  '**/apps/web/e2e/**',
  '**/packages/database/**',
  '**/apps/desktop/**',
  '**/*.config.{ts,js,mjs,cjs}',
  '**/playwright.config.ts',
  '**/*.{spec,test}.{ts,tsx}',
];

// Marker patterns matching the old lint:meta skipped-tests-need-tracking rule
// (an issue URL or a TODO(owner)). Kept faithful to the whole-repo scanner this
// replaces so no previously-tracked skip regresses.
const SKIPPED_TESTS_MARKERS = ['https?://\\S+', 'TODO\\([^\\s)]+\\)'];

// `architecture/single-semantic-module`, scoped to the file kinds whose name
// already states one concern. Measured when it was wired (non-test files,
// exported surface only):
//
//   kind           files  flagged  under the allow below
//   .types.ts        147        1  1 (since fixed: it exported constants)
//   .constants.ts     24       18  11 (every one exports functions)
//   .util.ts           4        2  1 (pending-invitation.util.ts: constant+function)
//
// Everything else stays off: .service 42/83, plain files 15/42 in the api,
// 24/29 in shared, .hooks 14/140 in the web. Those mix categories for reasons
// a file-kind rule cannot tell from drift.
//
// The two backlogs are files that predate the rule and break it. Each entry is
// a named debt, not a judgment that the mix is right, and the list only
// shrinks: tests/single-semantic-module.test.js fails on an entry that no
// longer breaks the rule. Paths are repo-relative, so the test can read them.
export const SINGLE_SEMANTIC_CONSTANTS_BACKLOG = [
  'apps/api/src/modules/auth/auth.constants.ts',
  'apps/api/src/modules/auth/oauth/oauth.constants.ts',
  'apps/web/src/features/audit/Audit.constants.ts',
  'apps/web/src/features/auth/Auth.constants.ts',
];

export const SINGLE_SEMANTIC_UTILS_BACKLOG = [
  'apps/api/src/modules/user/pending-invitation.util.ts',
];

// A repo-relative path as a glob that matches from whichever package config
// lints it (ESLint matches `ignores` against the path below that config).
const fromSrc = (path) => `**/src/${path.split('/src/')[1]}`;

/** @type {import("eslint").Linter.Config[]} */
export const config = [
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  {
    // No stale suppressions: a disable directive that suppresses nothing is an
    // error. Pairs with lint:meta's no-inline-lint-disable (which bans inline
    // disables outright in hand-written source).
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  {
    // Portable code-quality + contract rules applied repo-wide (error-or-off,
    // never warn). no-focused-tests / skipped-tests-need-tracking stay test-file
    // scoped in their own block below.
    plugins: {
      'code-quality': codeQuality,
      contracts,
    },
    rules: {
      'code-quality/no-historical-comments': 'error',
      'code-quality/no-narration-comments': 'error',
      'code-quality/no-pr-reference-comments': 'error',
      'contracts/no-direct-process-env': [
        'error',
        {
          configModule: '@nestjs/config',
          allowedFiles: NO_DIRECT_PROCESS_ENV_ALLOWED_FILES,
        },
      ],
      'code-quality/no-process-exit': ['error', { allowIn: NO_PROCESS_EXIT_ALLOW_IN }],
      'contracts/no-error-stringify': 'error',
      'code-quality/no-template-trim-empty-ternary': 'error',
      // A comment that stands in for deleted code (`... existing code ...`,
      // `rest of the function unchanged`) is what a whole-file write from an
      // abbreviated draft leaves behind; the code it names is gone and the file
      // still parses. Measured 0 hits across the tree when wired.
      'code-quality/no-elided-code-comments': 'error',
      // Measured 13 wrapped-body `if`s across the tree (desktop/ui/api/web), so
      // it stays 'off': the no-warn policy forbids a 'warn' rollout, and a
      // tree-wide guard-clause migration is out of scope. Flip to 'error' once
      // those sites are migrated.
      'code-quality/prefer-early-return': 'off',
    },
  },
  {
    // fetch has no default timeout: a peer that accepts the connection and stalls
    // hangs the caller (and, for a cached promise like the CSRF token, every
    // later caller) indefinitely. Every fetch must carry a `signal`. The rule
    // stays silent on spreads and opaque option bags, so wrappers that forward
    // `...init` are not flagged. Only this rule is enabled, not the plugin's
    // `recommended` preset, whose other rules are warn-level heuristics.
    plugins: {
      'noctcore-async-safety': asyncSafety,
    },
    rules: {
      'noctcore-async-safety/require-fetch-timeout': 'error',
      // A function that takes a `signal` and awaits work without passing it on
      // has a dead parameter: callers believe they can cancel and the I/O
      // ignores them. Measured 0 hits across the tree when wired.
      'noctcore-async-safety/forward-abort-signal': 'error',
      // A read-modify-write of an outer binding inside a concurrent
      // `Promise.all(xs.map(async ...))` callback loses updates, and only under
      // load. Measured 0 hits across the tree when wired.
      'noctcore-async-safety/no-concurrent-shared-mutation': 'error',
      // A `setTimeout` raced with `Promise.race` and never cleared outlives the
      // race whenever the work wins: one pending timer per call, holding its
      // closure and the event loop. Measured 0 hits across the tree when wired.
      'noctcore-async-safety/no-leaky-race-timeout': 'error',
      // The clients configured once at construction, which never see a
      // per-request `signal`. Both already carry their budgets (the storage and
      // object store clients set `requestHandler` timeouts, the SMTP provider
      // sets connection/greeting/socket timeouts); this keeps a new client from
      // shipping without one. The rule only proves a key is PRESENT.
      'noctcore-async-safety/require-client-timeout': [
        'error',
        {
          clients: [
            { callee: 'S3Client', construct: true, requireAnyOf: ['requestHandler'] },
            {
              callee: 'nodemailer.createTransport',
              requireAnyOf: ['connectionTimeout', 'socketTimeout'],
            },
          ],
        },
      ],
    },
  },
  {
    // A request or redirect whose ORIGIN is not fixed at authoring time is an
    // SSRF / open-redirect sink. Relative paths and author-written hosts closed
    // by `/` pass; a runtime value in the host position, or right after an
    // origin nothing has closed, is reported. The trust lists name expressions
    // by source text, so each entry below is one reviewed call shape.
    plugins: {
      'noctcore-security': security,
    },
    rules: {
      // An interpolated command string handed to a shell runner is command
      // injection. Every spawn in the tree passes the program and its argument
      // array separately; this keeps it that way. Measured 0 hits when wired.
      'noctcore-security/no-shell-interpolation': 'error',
      // An HMAC digest or signature compared with `===` or `Buffer#equals`
      // returns at the first differing byte, which leaks how much of a forgery
      // was right; `crypto.timingSafeEqual` does not. The rule decides by the
      // value's origin (`createHmac(...).digest()`, `crypto.subtle.sign`), not
      // its name. Measured 0 hits when wired.
      'noctcore-security/no-timing-unsafe-compare': 'error',
      // Web client: `getApiBaseUrl()` is the configured api origin ('' in the
      // browser, the Electron api URL on desktop). `CSRF_TOKEN_PATH` and
      // `OAUTH_PROVIDERS_PATH` are imported path constants the rule cannot read
      // across files. `toApiPath` (apps/web/src/lib/api-path.ts) validates a
      // server-issued ticket URL as a same-origin path before it is appended.
      'noctcore-security/no-user-controlled-fetch-url': [
        'error',
        {
          trustedOrigins: ['getApiBaseUrl()'],
          trustedPaths: ['CSRF_TOKEN_PATH', 'OAUTH_PROVIDERS_PATH'],
          sanitizers: ['toApiPath'],
        },
      ],
      // The plugin's default callees already read Express `res.redirect(status,
      // url)` by its LAST argument, so no callee override is needed (setting
      // one would REPLACE the defaults). The vocabulary is the OAuth
      // controller's: `this.shared.appUrl` is config,
      // `buildAuthErrorRedirect(appUrl, code)` returns a URL on it,
      // `provider.buildAuthorizationUrl()` is the identity provider's
      // authorization endpoint from its discovery document,
      // `OAUTH_TWO_FACTOR_CHALLENGE_PATH` is an imported path constant, and
      // `sanitizeReturnTo` (oauth-flow.service.ts) is the same-origin path
      // validator. A redirect built on the stored `flow.returnTo` passes only
      // when that call sits AT the redirect, which is where the controller
      // makes it.
      'noctcore-security/no-user-controlled-redirect': [
        'error',
        {
          trustedOrigins: [
            'this.shared.appUrl',
            'buildAuthErrorRedirect()',
            'provider.buildAuthorizationUrl()',
          ],
          sanitizers: ['sanitizeReturnTo'],
          trustedPaths: ['OAUTH_TWO_FACTOR_CHALLENGE_PATH'],
        },
      ],
    },
  },
  {
    // A `.types` file is type space only. An enum is a type here.
    files: ['**/*.types.{ts,tsx}'],
    plugins: {
      architecture,
    },
    rules: {
      'architecture/single-semantic-module': ['error', { enumCategory: 'type' }],
    },
  },
  {
    // A `.constants` file holds one module's enums, unions and DI tokens
    // (apps/api/src/modules/README.md), which mixes categories by design.
    files: ['**/*.constants.{ts,tsx}'],
    ignores: SINGLE_SEMANTIC_CONSTANTS_BACKLOG.map(fromSrc),
    plugins: {
      architecture,
    },
    rules: {
      'architecture/single-semantic-module': ['error', { allow: [['constant', 'type', 'enum']] }],
    },
  },
  {
    // A `.util` file is functions, with the types their signatures name.
    files: ['**/*.{util,utils}.{ts,tsx}'],
    ignores: SINGLE_SEMANTIC_UTILS_BACKLOG.map(fromSrc),
    plugins: {
      architecture,
    },
    rules: {
      'architecture/single-semantic-module': ['error', { allow: [['function', 'type']] }],
    },
  },
  {
    // fetch resolves on a 4xx/5xx, so `.json()` without an `.ok` / status check
    // parses an error body as data and the failure surfaces as a schema error
    // that names no status.
    plugins: {
      contracts,
    },
    rules: {
      'contracts/fetch-must-check-ok': 'error',
    },
  },
  {
    plugins: {
      turbo: turboPlugin,
    },
    // Severity policy: error-or-off, never warn (enforced by lint:meta's
    // eslint-config-no-warn rule).
    rules: {
      'turbo/no-undeclared-env-vars': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // A field that is an enum in one zod object schema must not be widened to
    // z.string() in a sibling schema of the same module: in tRPC the output is
    // the wire type the web imports, and a widened output leaks `string` to
    // every consumer, which then narrows or casts by hand. Only the shared
    // contract package declares its schemas under src/schemas; the pattern is
    // relative to the consuming package's eslint.config.js, so it cannot match
    // elsewhere. Imported identifiers are not assumed to be enums
    // (`enumIdentifierPattern` unset): a field such as `email: emailSchema` is a
    // string schema.
    files: ['src/schemas/**/*.ts'],
    plugins: {
      contracts,
    },
    rules: {
      'contracts/schema-enum-field-consistency': 'error',
    },
  },
  {
    // Test-file-scoped rules. no-focused-tests bans .only outright;
    // skipped-tests-need-tracking (migrated from the lint:meta whole-repo
    // scanner) requires every .skip/.fixme/xit/xdescribe to carry an owner.
    files: ['**/*.{spec,test}.{ts,tsx}'],
    plugins: {
      'code-quality': codeQuality,
    },
    rules: {
      'code-quality/no-focused-tests': 'error',
      'code-quality/skipped-tests-need-tracking': [
        'error',
        { markers: SKIPPED_TESTS_MARKERS, lookback: 30 },
      ],
      // An assertion a real regression cannot break (`toBeDefined()` alone,
      // `expect(typeof x).toBe('function')`, `expect(true).toBe(true)`).
      'code-quality/no-vacuous-expect': 'error',
      // An `expect` in a branch the test may skip passes with zero assertions.
      // `checkLoops` stays at its default (false): table-driven loops over
      // literal arrays are the bulk of loop hits and are not the defect.
      'code-quality/no-conditional-expect': 'error',
      // The mirror image: an assertion inside a `try` whose `catch` swallows
      // the error can never fail the test. Measured 0 hits when wired.
      'code-quality/no-swallowed-assertion': 'error',
      // Fake timers leak into later tests in the worker unless restored. The
      // signing-provider contract specs install them in a helper and the shared
      // `*.contract-suite.ts` restores them in its own afterEach, which
      // `followImportedSuites` (on by default, stated here because the repo
      // depends on it) accepts.
      'code-quality/fake-timers-must-be-restored': ['error', { followImportedSuites: true }],
      // A unit test calling fetch/axios for real. Playwright specs under e2e/
      // are skipped by the default integration markers.
      'code-quality/no-real-network-in-unit-tests': 'error',
    },
  },
  {
    // Test code is not a request-forgery surface: a spec that fetches does so
    // against a server it booted itself on a runtime port (and a unit test
    // that fetches for real is `no-real-network-in-unit-tests`'s concern).
    files: ['**/*.{spec,test}.{ts,tsx}'],
    rules: {
      'noctcore-security/no-user-controlled-fetch-url': 'off',
    },
  },
  {
    // `tsup.config.bundled_*.mjs` is a file tsup writes beside its config and
    // deletes when the build ends. On a COLD turbo cache a package's `build` and
    // its `lint` run at the same time, so eslint globs that file and then fails
    // to open it: "Oops! Something went wrong! ... ENOENT". Native runs mostly
    // hide it because the build is usually cached; a fresh CI checkout is not.
    ignores: ['dist/**', 'node_modules/**', 'tsup.config.bundled_*.mjs'],
  },
];
