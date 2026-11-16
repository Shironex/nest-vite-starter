/*
 * The lint-meta registry: what `harness lint-meta` runs and `harness catalog`
 * renders into RULES.md (see the root `lint:meta` and `*-lint-meta-docs`
 * scripts). The harness loads this module and reads `META_RULES`.
 *
 * Two kinds of rule sit here. This repo's own rules, under `rules/`, are
 * written against the local `IMetaRule` and go through `adoptLocalRule`. Generic
 * rules come from `@noctcore/lint-meta-rules` and go through `adoptHarnessRule`:
 * a starter inherits a guardrail by installing that package, not by copying
 * `tools/`. The order is the catalog's order.
 */
import {
  createDockerfileBaseImageDigestPinRule,
  createGithubActionsRunnerPinnedRule,
  createGithubActionsShaPinnedRule,
  createSecurityScannerVersionParityRule,
  createServiceImageDigestPinRule,
} from '@noctcore/lint-meta-rules';
import { createTranslationDeadKeysRule } from '@noctcore/lint-meta-rules/i18n';
import {
  createPrismaMethodSurfaceRule,
  createTenantModelRegistryParityRule,
} from '@noctcore/lint-meta-rules/prisma';
import { createEslintConfigNoWarnRule } from '@noctcore/lint-meta-rules/resolved-config';
import {
  createSessionEpochCapturedRule,
  createSessionLandingDeclaredRule,
  createSessionMintCallersRule,
} from '@noctcore/lint-meta-rules/session';
import {
  HAND_SCOPED_MODELS,
  HAND_SCOPE_PENDING,
  UNSCOPED_BY_DESIGN,
} from '../../packages/eslint-plugin-repo/src/utils/tenant-registry';
import { adoptHarnessRule, adoptLocalRule, assertEveryRuleBlocks } from './harness';
import type { IHarnessMetaRule } from './harness';
import { envCascadeDriftRule } from './rules/config/env-cascade-drift';
import { eslintOverridePathsExistRule } from './rules/config/eslint-override-paths-exist';
import { isolationCanaryCoverageRule } from './rules/config/isolation-canary-coverage';
import { requiredRulesAtErrorRule } from './rules/config/required-rules-at-error';
import { githubActionsExpressionSyntaxRule } from './rules/ci/github-actions-expression-syntax';
import { logRedactionDenylistParityRule } from './rules/config/log-redaction-denylist-parity';
import { githubActionsPermissionsRule } from './rules/ci/github-actions-permissions';
import { githubActionsTimeoutRequiredRule } from './rules/ci/github-actions-timeout-required';
import { launchPathParityRule } from './rules/ci/launch-path-parity';
import { prePushCiParityRule } from './rules/ci/pre-push-ci-parity';
import {
  noInlineLintDisableRule,
  noTsIgnoreRule,
  queueRegistrationThroughHelperRule,
} from './rules/source-text/forbidden-text';
import { apiModuleEdgesRule } from './rules/source-text/api-module-edges';
import { routeI18nSideEffectRule } from './rules/source-text/route-i18n-side-effect';
import { procedureRequiresOutputRule } from './rules/source-text/procedure-requires-output';
import { proceduresRequireGuardRule } from './rules/source-text/procedures-require-guard';
import { routesRequireTestSiblingRule } from './rules/testing/routes-require-test-sibling';
import { securitySpecNoSilentBailRule } from './rules/testing/security-spec-no-silent-bail';
import { securitySpecRequiresControlRule } from './rules/testing/security-spec-requires-control';
import { bannedDependenciesRule } from './rules/supply-chain/banned-dependencies';
// The pnpm override block is a security control with no reason, advisory or
// expiry of its own. overrides.ledger.json supplies those.
import { pnpmOverrideLedgerRule } from './rules/supply-chain/pnpm-override-ledger';
import { noctcorePackagesCurrentRule } from './rules/supply-chain/noctcore-packages-current';
import { githubActionsSecurityNoCancelRule } from './rules/ci/github-actions-security-no-cancel';
import { lintMetaRulesSelfCoveredRule } from './rules/testing/lint-meta-rules-self-covered';
// Small guards added together: the e2e suite, fixture dates, web env reads and tsconfig includes.
import { envNoDirectImportMetaEnvRule } from './rules/config/env-no-direct-import-meta-env';
import { tsconfigIncludePathsExistRule } from './rules/config/tsconfig-include-paths-exist';
import { noHardcodedDatesInFixturesRule } from './rules/testing/no-hardcoded-dates-in-fixtures';
import { noSleepInE2eRule } from './rules/testing/no-sleep-in-e2e';
// The two rot checks: the generated module map and the invariant manifests must
// still match the tree.
import { archMapFreshRule } from './rules/config/arch-map-fresh';
import { invariantManifestFreshRule } from './rules/config/invariant-manifest-fresh';
// The config surface a derived starter is configured from (tools/starter/starter-manifest.json).
import { configSurfaceCompleteRule } from '../starter/config-surface';

/*
 * The three config checks, from the package. The local copies they replace were
 * this repo's own; the versions here are the same checks made parameterized, and
 * the no-warn one fixes a false negative the local copy had: it failed closed
 * only when EVERY probe failed to resolve, so a single unresolvable file shape
 * was discarded and a `warn` visible only through that shape went unreported.
 */
const eslintConfigNoWarnRule = adoptHarnessRule(createEslintConfigNoWarnRule());

/*
 * The registry data stays here because it is this repo's: which models the
 * runtime extension isolates, which are exempt and why, and what each exempt
 * model is scoped by instead. The check reads the runtime map at its source
 * rather than a copy of it, and reads the STATIC side out of the resolved ESLint
 * config, so moving the array or spreading a different preset is still caught.
 */
const tenantModelRegistryParityRule = adoptHarnessRule(
  createTenantModelRegistryParityRule({
    schemaPath: 'packages/database/prisma/schema',
    tenantFields: ['tenantId'],
    registry: {
      scopedModels: [],
      unscopedByDesign: UNSCOPED_BY_DESIGN,
      handScopedModels: HAND_SCOPED_MODELS,
      handScopePending: HAND_SCOPE_PENDING,
    },
    scopedModelsSource: {
      file: 'apps/api/src/common/database/tenant-scope.extension.ts',
      exportName: 'TENANT_SCOPED_MODELS',
    },
    eslint: {
      cwd: 'apps/api',
      probe: 'src/modules/example/example.service.ts',
      configFile: 'packages/eslint-config/nestjs.js',
    },
    registryFile: 'packages/eslint-plugin-repo/src/utils/tenant-registry.ts',
  }),
);

/*
 * New here: the method surface the Prisma fences police must be exactly what the
 * generated client exposes, so a Prisma upgrade that adds a delegate method
 * turns CI red instead of widening an unguarded surface in silence.
 */
const prismaMethodSurfaceRule = adoptHarnessRule(
  createPrismaMethodSurfaceRule({
    // The schema sets `output = "../../generated/prisma"`, so the per-model
    // delegates land here rather than at either of the factory's defaults.
    clientGlobs: ['packages/database/generated/prisma/models/*.ts'],
  }),
);

/*
 * The other half of `contracts/translation-key-exists`. That rule asks whether a
 * key a call site names exists; this asks whether a key the catalog holds is
 * named by anything. It cannot be an ESLint rule: a per-file rule never sees
 * every call site, and keys flow as data. The resolution options must match the
 * ones apps/web/eslint.config.js passes the ESLint half, or the two disagree
 * about which key a call site means.
 */
const translationDeadKeysRule = adoptHarnessRule(
  createTranslationDeadKeysRule({
    catalogs: [
      { file: 'apps/web/src/lib/i18n/locales/en.json', keyPath: '{ns}' },
      { file: 'apps/web/src/features/{ns}/locales/en.json' },
    ],
    defaultNamespace: 'common',
    namespaceIdentifiers: {
      AUDIT_NS: 'audit',
      AUTH_NS: 'auth',
      DASHBOARD_NS: 'dashboard',
      WORKSPACE_NS: 'workspace',
      HELP_NS: 'help',
    },
    sourceGlobs: ['apps/web/src/**/*.ts', 'apps/web/src/**/*.tsx'],
  }),
);

/*
 * The five CI-hygiene rules, from the package. Their defaults are the values
 * the local copies hardcoded (gitleaks, `GITLEAKS_VERSION`, `GITLEAKS_IMAGE`,
 * `scripts/ci/pre-push.sh`, `.github/workflows/*.y(a)ml`, the same skip dirs),
 * so the only option this repo sets is the one exemption below.
 */
const githubActionsShaPinnedRule = adoptHarnessRule(createGithubActionsShaPinnedRule());
const githubActionsRunnerPinnedRule = adoptHarnessRule(createGithubActionsRunnerPinnedRule());
const securityScannerVersionParityRule = adoptHarnessRule(createSecurityScannerVersionParityRule());
const dockerfileBaseImageDigestPinRule = adoptHarnessRule(createDockerfileBaseImageDigestPinRule());
const serviceImageDigestPinRule = adoptHarnessRule(
  createServiceImageDigestPinRule({
    /*
     * The registry does not serve it: Docker Hub has no `0.125.0` tag for the
     * OpenTelemetry collector (it lists no 0.125.x at all), so the observability
     * stack's collector already fails to pull and there is no digest to write.
     * Bumping it to a tag that exists is a behavior change outside this rule;
     * when that happens the pinned ref passes on its own and this entry can go.
     */
    allowUnpinned: ['otel/opentelemetry-collector-contrib:0.125.0'],
  }),
);

/*
 * The four fences around the seam that mints a session, from the package. They
 * were this repo's own rules; the package versions are the same checks with every literal made an option, so the ids
 * stay and the facts below (which method mints, which files may call it, where
 * each door lands) are this repo's.
 *
 * The scope is what the local copies read: the application workspaces only
 * (`apps/`, not `packages/` or `tools/`, since a lint-meta rule quoting the call
 * in its own message is not a mint), minus tests, which drive the seam directly.
 * `__lint_edited_probe__` is the edit-hook test's transient fixture, skipped for
 * the same reason `buildContext` skips it.
 */
const SKIP_DIRS = ['node_modules', '.git', 'dist', '.turbo', 'coverage', '__lint_edited_probe__'];
const AUTH = 'apps/api/src/modules/auth';
const SESSION_SCOPE = {
  sourceGlobs: ['apps/*/{src,test,tests,security-spec}/**/*.{ts,tsx}'],
  skipDirs: SKIP_DIRS,
  excludeSuffixes: ['.spec.ts', '.test.ts', '.test.tsx'],
};

/*
 * `establishSession` mints the cookie and rotates CSRF directly, so a sign-in
 * that calls it skips the 2FA challenge in `beginOrEstablish`. The allowlist is
 * the method's home, the challenge seam, and the three flows with no challenge
 * to pass: signup (no factor yet), and two re-issues to a caller who already
 * holds a session.
 */
const establishSessionCallersRule = adoptHarnessRule(
  createSessionMintCallersRule({
    id: 'establish-session-callers',
    mintCall: 'establishSession',
    gateCall: 'TwoFactorChallengeService.beginOrEstablish',
    allowedCallers: [
      `${AUTH}/services/auth-shared.service.ts`,
      `${AUTH}/services/two-factor-challenge.service.ts`,
      `${AUTH}/services/register.service.ts`,
      `${AUTH}/services/password-change.service.ts`,
      `${AUTH}/services/session-management.service.ts`,
    ],
    hint: 'The allowlist lives in tools/lint-meta/registry.ts.',
    ...SESSION_SCOPE,
  }),
);

/*
 * The epoch fence covers only what happens after the epoch is read, so every
 * sign-in reads `SessionService.readEpoch(userId)` before the credential and
 * passes it into the challenge seam. The seam's own file defines the method and
 * its default. This one reads packages/ and tools/ as well, as the local copy
 * did, and skips only `.spec.ts` and `.test.ts`.
 */
const sessionEpochCapturedRule = adoptHarnessRule(
  createSessionEpochCapturedRule({
    call: 'beginOrEstablish',
    exempt: [`${AUTH}/services/two-factor-challenge.service.ts`],
    captureCall: 'sessionService.readEpoch(userId) (see LoginService.login)',
    hint: 'Read SessionService.readEpoch(userId) before the credential and pass it into the challenge seam.',
    sourceGlobs: [
      'apps/*/{src,test,tests,security-spec}/**/*.{ts,tsx}',
      'packages/*/{src,test,tests,security-spec}/**/*.{ts,tsx}',
      'tools/**/*.{ts,tsx}',
    ],
    skipDirs: SKIP_DIRS,
    excludeSuffixes: ['.spec.ts', '.test.ts'],
  }),
);

/*
 * A sign-in can end in more than one place (signed in, 2FA challenge, verify
 * your email), and the client can only route correctly if the response that
 * ends the sign-in says which, which for a tRPC sign-in means returning
 * ILoginResult. The 2FA challenge is a second door that finishes a sign-in on
 * its own, and it is the kind of door that ships without its landing wired.
 * Every door is declared here, and a new one fails the build until somebody
 * classifies it.
 */
const sessionLandingDeclaredRule = adoptHarnessRule(
  createSessionLandingDeclaredRule({
    doorCalls: ['establishSession', 'beginOrEstablish'],
    landings: { 'login-result': 'Promise<ILoginResult>', reissue: null, 'server-decided': null },
    doors: [
      {
        file: `${AUTH}/services/login.service.ts`,
        landing: 'login-result',
        because:
          'The password sign-in. It can end signed in, in a 2FA challenge or with an unverified email, so the response has to say which.',
      },
      {
        file: `${AUTH}/services/two-factor-challenge.service.ts`,
        landing: 'login-result',
        because:
          'The second door: verifyChallenge finishes a sign-in on its own, returning the same union from a different service.',
      },
      {
        file: `${AUTH}/oauth/oauth.controller.ts`,
        landing: 'server-decided',
        because:
          'A provider sign-in redirects rather than returning a union: the server decides the landing (the app home, or the 2FA challenge screen) and sends the browser there.',
      },
      {
        file: `${AUTH}/services/register.service.ts`,
        landing: 'server-decided',
        because:
          'Self-signup has one outcome: a new Tenant, its owner ADMIN, and the verify-your-email notice. There is nothing for the response to choose between.',
      },
      {
        file: `${AUTH}/services/password-change.service.ts`,
        landing: 'reissue',
        because:
          'The caller already holds a session and is already inside a shell. The re-issue replaces the cookie underneath them; it does not navigate, so there is no landing to get wrong.',
      },
      {
        file: `${AUTH}/services/session-management.service.ts`,
        landing: 'reissue',
        because:
          'Same shape as password change: revokeOthers re-issues the caller their own session.',
      },
    ],
    hint: 'The doors are declared in tools/lint-meta/registry.ts. A door that can end a sign-in in more than one place returns ILoginResult (the api side of loginOutput).',
    ...SESSION_SCOPE,
  }),
);

export const META_RULES: readonly IHarnessMetaRule[] = assertEveryRuleBlocks([
  eslintConfigNoWarnRule,
  ...[
    eslintOverridePathsExistRule,
    requiredRulesAtErrorRule,
    logRedactionDenylistParityRule,
    envCascadeDriftRule,
    noInlineLintDisableRule,
    noTsIgnoreRule,
    queueRegistrationThroughHelperRule,
    apiModuleEdgesRule,
  ].map(adoptLocalRule),
  establishSessionCallersRule,
  ...[routeI18nSideEffectRule].map(adoptLocalRule),
  sessionEpochCapturedRule,
  sessionLandingDeclaredRule,
  ...[
    proceduresRequireGuardRule,
    procedureRequiresOutputRule,
    routesRequireTestSiblingRule,
    securitySpecNoSilentBailRule,
    securitySpecRequiresControlRule,
    isolationCanaryCoverageRule,
    bannedDependenciesRule,
    pnpmOverrideLedgerRule,
    noctcorePackagesCurrentRule,
    githubActionsPermissionsRule,
    githubActionsTimeoutRequiredRule,
    launchPathParityRule,
    prePushCiParityRule,
    githubActionsSecurityNoCancelRule,
    lintMetaRulesSelfCoveredRule,
    noSleepInE2eRule,
    noHardcodedDatesInFixturesRule,
    envNoDirectImportMetaEnvRule,
    tsconfigIncludePathsExistRule,
  ].map(adoptLocalRule),
  tenantModelRegistryParityRule,
  prismaMethodSurfaceRule,
  translationDeadKeysRule,
  githubActionsShaPinnedRule,
  serviceImageDigestPinRule,
  githubActionsRunnerPinnedRule,
  adoptLocalRule(githubActionsExpressionSyntaxRule),
  securityScannerVersionParityRule,
  dockerfileBaseImageDigestPinRule,
  ...[archMapFreshRule, invariantManifestFreshRule, configSurfaceCompleteRule].map(adoptLocalRule),
]);
