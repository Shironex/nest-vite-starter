import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import repoPlugin, {
  SOFT_DELETE_ALLOW_IN_FUNCTIONS,
  SOFT_DELETE_MODELS,
} from '@repo/eslint-plugin-repo';
import architecture from '@noctcore/eslint-plugin-architecture';
import codeQuality from '@noctcore/eslint-plugin-code-quality';
import contracts from '@noctcore/eslint-plugin-contracts';
import prisma from '@noctcore/eslint-plugin-prisma';
import observability from '@noctcore/eslint-plugin-observability';
import { config as baseConfig } from './base.js';

// The old repo/no-bare-date-now allowlist entries were already anchored with a
// leading `**\/`, so they carry over unchanged to the noctcore `allowIn` option
// (which matches against the absolute filename).
const NO_BARE_DATE_NOW_ALLOW_IN = [
  '**/common/clock/clock.ts',
  '**/otel.ts',
  '**/modules/logger/logger.middleware.ts',
  '**/modules/health/indicators/database.health.ts',
  '**/modules/health/indicators/redis.health.ts',
];

// The Prisma client's own property on the api's PrismaService (`this.client`),
// the receiver the two transaction rules treat as "the outer client".
const PRISMA_CLIENT_PROPERTIES = ['client'];

// Seeds, migrations and the integration lane: the files that legitimately work
// with raw rows. Every allowlist below starts from these.
const SEED_AND_MIGRATION_FILES = [
  '**/prisma/seed.ts',
  '**/*.seed.ts',
  '**/prisma/migrations/**',
  '**/*.isolation.spec.ts',
];

// Where `restrict-model-writes` reads the schema to derive the relation fields
// that reach a guarded model (a nested write through any of them is a write to
// the guarded model). A folder: the schema is split per domain.
const PRISMA_SCHEMA_PATH = 'packages/database/prisma/schema';

// The single-writer fences. Each guarded model has ONE owner that keeps an
// invariant spanning several rows or tables, and any other writer breaks it
// without failing at runtime. The owner, its repository, their specs, and the
// seed / migration / isolation files may write; nobody else may, directly or
// through a nested write on another model.
//
// The rule restricts WHO writes; it does not validate which state transitions
// are legal. The owners do that.
// None yet: add a restriction when a model gets an owner that keeps an
// invariant spanning several rows. The rule is wired, and inert until then.
const SINGLE_WRITER_FENCES = [];

// The error taxonomy `contracts/restrict-throw-to-taxonomy` holds api source to.
// The rule matches the constructor's SIMPLE name and cannot follow `extends`, so
// every subclass is listed by name. The abstract `DomainError` base is left out:
// it cannot be constructed.
//
// The published rule defaults to `allow: ['Error']`, which is the opposite of
// what this repo needs: it would report none of the ad hoc throws it exists to
// find. `Error` is deliberately NOT here. A throw a caller can observe is a
// `DomainError` subclass (mapped to an `appCode` at the tRPC boundary); a broken
// internal invariant is an `InvariantError` (common/errors/invariant-error.ts).
//
//  - the DomainError subclasses in common/errors/domain-error.ts
//  - ConcurrencyError (BaseRepository's optimistic-version loser)
//  - UnrecoverableError (BullMQ: fails a job straight to the DLQ, no retry)
//  - TRPCError (routers and middleware that sit on the wire boundary itself)
const ERROR_TAXONOMY = [
  'ValidationError',
  'UnauthorizedError',
  'ForbiddenError',
  'NotFoundError',
  'ConflictError',
  'RateLimitError',
  'ConcurrencyError',
  'InvariantError',
  'UnrecoverableError',
  'TRPCError',
];

// Plain-HTTP controllers (health, csrf-token) answer through `AllExceptionsFilter`, which maps
// only `HttpException`. They sit OUTSIDE the tRPC boundary, so at that edge, and
// only there, the Nest built-ins are the taxonomy. The list is the three a
// controller may throw; a fourth is a deliberate addition here. A service still
// throws a DomainError and the controller translates it. Scoped to
// `*.controller.ts` so a service that reaches for `NotFoundException` is still
// reported.
const HTTP_CONTROLLER_EXCEPTIONS = [
  'BadRequestException',
  'NotFoundException',
  'UnauthorizedException',
];

// Field names `observability/no-sensitive-fields-in-logs` refuses inside a logger
// call. A HAND-KEPT MIRROR of SENSITIVE_KEY_PATTERNS in
// packages/shared/src/logger/index.ts, the list the runtime redactor and the
// Sentry scrubber share. It cannot be imported: @repo/shared already depends on
// this package, so the reverse edge is a workspace cycle. The
// `log-redaction-denylist-parity` lint:meta rule holds the two equal, so adding
// a pattern to the runtime list without adding it here is red before the push.
//
// The published rule matches whole name SEGMENTS (`sessionId` is `session` +
// `id`, so it matches `sessionid` only as a compacted multi-word entry) and has
// no allowlist, so a key the runtime treats as safe (SAFE_KEY_ALLOWLIST, e.g.
// `contentLength`) is still reported here: rename it at the call site.
const LOG_DENY_NAMES = [
  'password',
  'passwd',
  'secret',
  'token',
  'authorization',
  'cookie',
  'csrf',
  'apikey',
  'api_key',
  'api-key',
  'ssn',
  'card',
  'cvv',
  'cvc',
  'email',
  'phone',
  'sessionid',
  'session_id',
  'sid',
  'body',
  'notes',
  'content',
  'encryptionkey',
  'encryption_key',
  'bankaccount',
  'bank_account',
  'iban',
  'iddoc',
  'residencedoc',
  'birthdate',
  'birth_date',
  'emergencycontact',
  'emergency_contact',
];

// Services and queue processors that must ship a colocated `<name>.spec.ts`
// (`architecture/colocated-test-required`). The rule reads the directory on disk
// and has no changed-files mode, so it cannot ask for a spec only of new or
// touched files.
const COLOCATED_TEST_INCLUDE = ['**/src/**/*.service.ts', '**/src/**/*.processor.ts'];

// The BACKLOG: services that predate the rule and have no colocated spec. Every
// entry is a named debt, not a judgment that the file needs no test. Exact
// paths, never a directory glob, so a NEW service in the same folder is still
// required to carry its spec.
//
// This list only shrinks. Adding a spec means deleting its line here (the wiring
// test in tests/nestjs-noctcore-rules.test.js pins that every entry still names
// a real file WITHOUT a spec, so a stale line is red, not silently permissive).
// What it gives up: touching a listed file does not demand a spec, because the
// rule cannot tell a changed file from an untouched one.
const COLOCATED_TEST_BACKLOG = [];

// `observability/audit-pii-declared`: audit payload keys that hold personal
// data and are to be scrubbed when their subject is purged. `newEmail` is the
// requested address (email-change requested); `email` is the before/after pair
// of a completed email change.
//
// THE list, read from the one file `@repo/shared` also exports it from. It is
// read rather than imported because @repo/shared already depends on this
// package, and the reverse edge is a workspace cycle turbo refuses to schedule;
// JSON is what both sides can read without either depending on the other. The
// `audit-pii-registry.parity.spec.ts` api spec resolves this config and checks
// the read still reaches the rule.
const AUDIT_PII_REGISTERED_FIELDS = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../shared/src/audit/pii-fields.json'),
    'utf8',
  ),
).fields;

// Keys that match a PII pattern but are declared not to be personal data.
// Empty today: every PII-shaped key the rule has found is registered above.
const AUDIT_NON_PII_FIELDS = [];

const AUDIT_PII_OPTIONS = {
  auditCallees: ['auditService.log', 'auditService.logOrThrow'],
  registeredFields: AUDIT_PII_REGISTERED_FIELDS,
  nonPiiFields: AUDIT_NON_PII_FIELDS,
};

/** @type {import("eslint").Linter.Config[]} */
export const config = [
  ...baseConfig,
  {
    // NestJS queue + clock conventions. Enabled here (the NestJS app config)
    // rather than base.js because they are backend-shaped and the `common/clock`
    // util they require lives in apps/api. Scoped to non-spec source: the repo
    // bans inline eslint-disable and made unused disables an error, so there
    // is no per-line escape hatch: a test fixture that enqueues with a literal
    // job name must not be policed by these production-code rules. The queue
    // trio remains in @repo/eslint-plugin-repo (no published noctcore home yet);
    // no-bare-date-now is now the portable @noctcore/eslint-plugin-code-quality
    // rule.
    files: ['**/*.ts'],
    // Production-code rules: skip specs AND test-support dirs (fixtures, e2e
    // helpers). The repo bans inline eslint-disable, so there is no per-line
    // escape hatch and these must not police test scaffolding.
    ignores: ['**/*.{spec,test}.ts', '**/test/**'],
    plugins: {
      repo: repoPlugin,
      'code-quality': codeQuality,
    },
    rules: {
      'repo/job-name-must-be-constant': 'error',
      'code-quality/no-bare-date-now': ['error', { allowIn: NO_BARE_DATE_NOW_ALLOW_IN }],
    },
  },
  {
    // Type-aware promise rules. A promise nobody awaits and nobody
    // `.catch`es becomes an unhandled rejection, and main.ts's policy for those
    // is to log and EXIT, so a dropped promise is an availability bug the
    // untyped `tseslint.configs.recommended` in base.js cannot see (a bare call
    // with no `void` is invisible to grep too). Deliberate fire-and-forget work
    // goes through `detach()` (apps/api/src/common/utils/detach.ts), never a
    // bare `void`.
    //
    // The only type-aware block in the repo: `projectService` makes each file
    // resolve its nearest tsconfig.json, which roughly doubles the api's lint
    // time, so it stays scoped to production source (specs build promises
    // on purpose and are awaited by the runner, not by the code under test).
    files: ['src/**/*.ts'],
    ignores: ['**/*.{spec,test}.ts', '**/test/**'],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    plugins: {
      'noctcore-prisma': prisma,
    },
    rules: {
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }],
      '@typescript-eslint/no-misused-promises': 'error',
      // The rule the README used to claim. It follows the calls the checker
      // resolved, across files, from each `@Mutation()` and reports an entry
      // that can reach a Prisma write but no audit write. It needs type
      // information, which is why it lives in this block and not with the other
      // Prisma fences, and why it is not in the plugin's `recommended`.
      //
      // What it does NOT prove: that the audit runs on every path, that it
      // records THIS write, or anything about a mutation no entry point
      // reaches. An entry whose call graph it cannot fully read is skipped, not
      // reported.
      'noctcore-prisma/mutation-entry-must-reach-audit': 'error',
    },
  },
  {
    // interface-prefix-i: enforce the `I` prefix on every interface in the
    // backend source. Unlike the queue/clock rules above, this MUST police spec
    // files too (a renamed interface used in a test still has to match), so this
    // config intentionally does NOT ignore `**/*.{spec,test}.ts`.
    files: ['src/**/*.ts'],
    plugins: {
      'code-quality': codeQuality,
    },
    rules: {
      'code-quality/interface-prefix-i': 'error',
    },
  },
  {
    // Tenancy + Prisma data-integrity rules, from
    // @noctcore/eslint-plugin-prisma. Production-code only: specs and
    // test-support dirs legitimately do multiple non-transactional writes
    // through the client in setup, so policing them would manufacture false
    // positives. Scoped to src/**/*.ts and ignoring specs/test, mirroring the
    // queue/clock block above.
    //
    // The published rules ship generic defaults, so every SaaS Starter convention is
    // passed here: the allowlists, the model registries, the soft-delete helper
    // and the single-writer fences. Each option reproduces what the former local
    // copy hardcoded, proven location-for-location on the whole repo before the
    // local copies were deleted.
    files: ['src/**/*.ts'],
    ignores: ['**/*.{spec,test}.ts', '**/test/**'],
    plugins: {
      'noctcore-prisma': prisma,
      repo: repoPlugin,
    },
    rules: {
      'noctcore-prisma/prisma-write-in-transaction': [
        'error',
        { clientProperties: PRISMA_CLIENT_PROPERTIES },
      ],
      'noctcore-prisma/prisma-tx-uses-tx-not-client': [
        'error',
        { clientProperties: PRISMA_CLIENT_PROPERTIES },
      ],
      // Raw SQL is the escape hatch: a raw query has no model, so every
      // model-level guard (soft-delete filters, select allowlists) passes it
      // by. A tagged template that names no table (the probes, the advisory
      // locks) passes; anything that can touch a table needs a reviewed
      // allowlist entry.
      'noctcore-prisma/no-raw-sql-outside-allowlist': [
        'error',
        { allowedFiles: SEED_AND_MIGRATION_FILES },
      ],
      // Keeps an audit write OUT of a transaction callback, so a rolled-back
      // transaction cannot take its audit row with it. That is all it checks:
      // it does not prove that a mutation writes an audit row at all.
      'noctcore-prisma/no-audit-write-in-transaction': 'error',
      // Mass assignment: a write whose `data` or `where` is the raw request
      // (`req.body`, `request.json()`, ...) lets the caller set any column, or
      // widen a bulk write with operators. The default sources are the Express
      // shapes the REST controllers use; a tRPC `@Input()` is already the
      // zod-parsed value, which is the fix the rule asks for. Measured 0 hits
      // when wired.
      'noctcore-prisma/no-request-body-in-write': 'error',
      // Soft delete has no runtime enforcement layer at all: `deletedAt` has
      // only the `BaseRepository.notDeleted` convention, so this lint IS the
      // line. A read that forgets it returns
      // deleted rows and a bulk write that forgets it mutates them, and both
      // type-check and pass their tests.
      'noctcore-prisma/soft-deletable-tables-require-deleted-at': [
        'error',
        {
          softDeleteModels: SOFT_DELETE_MODELS,
          allowInFunctions: SOFT_DELETE_ALLOW_IN_FUNCTIONS,
          softDeleteSpreads: ['notDeleted'],
        },
      ],
      // The single-writer fences, one restriction each. See SINGLE_WRITER_FENCES.
      'noctcore-prisma/restrict-model-writes': [
        'error',
        { schemaPath: PRISMA_SCHEMA_PATH, restrictions: SINGLE_WRITER_FENCES },
      ],
      // money-must-be-decimal is NOT enabled: it is a dormant
      // guard that activates when the first money field lands. Its name
      // patterns are case-insensitive SUBSTRINGS, so the list below would also
      // claim a class property such as `totalCount: number` or `checksum:
      // number`; wiring it before there is a money type to point at buys that
      // friction for nothing. Measured with exactly these options
      // it reports 0 hits across api, web, shared, database, desktop, ui and
      // email (interface members and untyped initializers are out of its
      // scope, which is why pagination `total` never trips it). Wiring target:
      // @noctcore/eslint-plugin-contracts `money-must-be-decimal` with
      // { decimalType: 'Prisma.Decimal', fieldPatterns: ['amount','price',
      // 'total','netto','brutto','vat','kwota','cena','wartosc','sum','balance',
      // 'fee','cost'] }.
    },
  },
  {
    // Error taxonomy. Production source only: a spec throws whatever its fixture
    // needs, and `*.contract-suite.ts` is test support that ships in src/ (it is
    // the shared body of the signing-provider contract tests), so it gets the
    // same exemption as the spec files. `ignores` mirrors the queue/clock block.
    files: ['src/**/*.ts'],
    ignores: ['**/*.{spec,test}.ts', '**/test/**', '**/*.contract-suite.ts'],
    plugins: {
      contracts,
    },
    rules: {
      'contracts/restrict-throw-to-taxonomy': ['error', { allow: ERROR_TAXONOMY }],
    },
  },
  {
    // Structured logging. Production source only, like the queue/clock block: a
    // spec logs whatever its fixture needs. The rules match the logger by
    // receiver name (`logger`, `this.logger`, `console`, `log`) and the methods
    // info/warn/error/debug.
    //
    // KNOWN BLIND SPOT, upstream: the methods are a fixed set in
    // @noctcore/eslint-plugin-observability (still true of 0.3.1), so Nest's `logger.log(...)`
    // (also `verbose` and `fatal`) is invisible to BOTH rules, and
    // `no-sensitive-fields-in-logs` does not even accept the `loggers` option.
    // A `methods` option is the fix and is not published yet. Until then a
    // `.log(` call gets no lint at all; new code should use `.debug`/`.info`.
    files: ['src/**/*.ts'],
    ignores: ['**/*.{spec,test}.ts', '**/test/**'],
    plugins: {
      observability,
    },
    rules: {
      'observability/structured-log-arguments': 'error',
      // Ships at `warn` upstream, but this repo has no warn level (lint:meta's
      // eslint-config-no-warn), so it is wired at `error`. It reads NAMES, not
      // values, so a hit means "look here": fix it by not logging the value,
      // or by naming the field for what it is.
      'observability/no-sensitive-fields-in-logs': ['error', { denyNames: LOG_DENY_NAMES }],
    },
  },
  {
    // Audit rows outlive the request and usually the user. The owner's policy is
    // SCRUB ON PURGE: a PII-shaped key may sit in an audit payload while its
    // subject exists, and the purge anonymizes it. This rule enforces only the
    // DECLARATION half: every PII-shaped key an audit write puts in a payload
    // it can read is registered (AUDIT_PII_REGISTERED_FIELDS) or declared not
    // personal (AUDIT_NON_PII_FIELDS). It does not prove that anything scrubs.
    files: ['src/**/*.ts'],
    ignores: ['**/*.{spec,test}.ts', '**/test/**'],
    plugins: {
      observability,
    },
    rules: {
      'observability/audit-pii-declared': ['error', AUDIT_PII_OPTIONS],
    },
  },
  {
    // Every service and queue processor carries its own spec beside it. Specs
    // themselves are skipped (the rule would otherwise never ask a test to test
    // itself, and a spec is not production source).
    files: ['src/**/*.ts'],
    ignores: ['**/*.{spec,test}.ts', '**/test/**'],
    plugins: {
      architecture,
    },
    rules: {
      'architecture/colocated-test-required': [
        'error',
        { include: COLOCATED_TEST_INCLUDE, ignore: COLOCATED_TEST_BACKLOG },
      ],
    },
  },
  {
    // Request-lifetime safety for production source. Specs hold module-level
    // fixtures on purpose and are not request handlers, so they are skipped.
    //
    // `no-shared-mutable-module-state` is inert until `include` arms it: module
    // scope is process-wide on a server, so a module-level `let` or container
    // written from an exported async function is shared by every concurrent
    // request, and leaks one user's data into another's. The api's caches live
    // on injected providers, which the rule does not claim.
    //
    // `require-path-containment` reports request-shaped input (`req.*`) passed
    // straight into `path.join` / `path.resolve`. Nest hands most input over
    // through decorators, so this is a tripwire for raw-request handlers, not
    // a sweep.
    //
    // Both measured 0 hits when wired.
    files: ['src/**/*.ts'],
    ignores: ['**/*.{spec,test}.ts', '**/test/**'],
    rules: {
      'noctcore-async-safety/no-shared-mutable-module-state': ['error', { include: ['**/src/**'] }],
      'noctcore-security/require-path-containment': 'error',
    },
  },
  {
    // The same rule at the plain-HTTP edge, with the Nest built-ins added. A
    // later block replaces the option object wholesale, so this restates the
    // taxonomy rather than extending it.
    files: ['src/**/*.controller.ts'],
    ignores: ['**/*.{spec,test}.ts', '**/test/**'],
    plugins: {
      contracts,
    },
    rules: {
      'contracts/restrict-throw-to-taxonomy': [
        'error',
        { allow: [...ERROR_TAXONOMY, ...HTTP_CONTROLLER_EXCEPTIONS] },
      ],
    },
  },

  // NOT WIRED: `contracts/require-registered-keys` for the ioredis key methods
  // (`redis.get/set/setex/del/...` fed from common/redis/redis-keys.ts).
  // As published (@noctcore/eslint-plugin-contracts 0.6.0) it can never match
  // here: `calleePath` returns null for any callee rooted at `this`, and every
  // Redis call in the api is `this.redis.<method>(...)`. A `sinks` entry of
  // `redis.set` is inert and `this.redis.set` is skipped, so wiring it would be
  // a rule that reports nothing by construction. It also only flags a raw string
  // LITERAL, and no `this.redis.*` call passes one today (every key is a
  // `RedisKeys.*` helper or a variable), so it would be a pure tripwire even once
  // fixed.
  // Upstream ask: match `sinks` by dotted SUFFIX (or resolve a leading `this`),
  // so `redis.set` matches `this.redis.set`. Wire it here with
  // `sinks: [{ callee: 'redis.<method>', argIndex: 0 }, ...]` and
  // `registry: '<path to common/redis/redis-keys>'` once that is published.
];
