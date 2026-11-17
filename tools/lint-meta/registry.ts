/*
 * The lint-meta registry: what `pnpm lint:meta` runs and what
 * `pnpm lint:meta:docs` renders into RULES.md. `@noctcore/harness` loads this
 * module and reads `META_RULES`, in order.
 *
 * Every rule here is required and fails the build (`ciCritical`). The list is
 * short on purpose, three kinds only:
 *   - auth: the tRPC guard list and the fences around the session seam;
 *   - security: the security ESLint rules stay at error, and the raw SQL
 *     allowlist is pinned;
 *   - the gate itself: nothing may loosen the ESLint, tsconfig or CI gate.
 *
 * Prefer a published rule from `@noctcore/lint-meta-rules`, configured here,
 * over local code under `rules/`. See tools/README.md for adding one.
 */
import type { IMetaRule } from '@noctcore/harness';
import {
  createGithubActionsLeastPrivilegePermissionsRule,
  createGithubActionsShaPinnedRule,
} from '@noctcore/lint-meta-rules';
import { createEslintConfigNoWarnRule } from '@noctcore/lint-meta-rules/resolved-config';
import {
  createSessionEpochCapturedRule,
  createSessionLandingDeclaredRule,
  createSessionMintCallersRule,
} from '@noctcore/lint-meta-rules/session';
import {
  createNoInlineLintDisableRule,
  createNoTsIgnoreRule,
} from '@noctcore/lint-meta-rules/typescript';

import { proceduresRequireGuardRule } from './rules/procedures-require-guard';
import {
  rawSqlAllowlistPinnedRule,
  requiredRulesAtErrorRule,
} from './rules/required-rules-at-error';
import { tsconfigStrictRule } from './rules/tsconfig-strict';

/*
 * The session fences read application source only (`apps/`), minus tests,
 * which drive the seam directly.
 */
const SKIP_DIRS = ['node_modules', '.git', 'dist', '.turbo', 'coverage'];
const AUTH = 'apps/api/src/modules/auth';
const SESSION_SCOPE = {
  sourceGlobs: ['apps/*/{src,test,tests}/**/*.{ts,tsx}'],
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
const establishSessionCallersRule = createSessionMintCallersRule({
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
});

/*
 * The epoch fence covers only what happens after the epoch is read, so every
 * sign-in reads `SessionService.readEpoch(userId)` before the credential and
 * passes it into the challenge seam.
 */
const sessionEpochCapturedRule = createSessionEpochCapturedRule({
  call: 'beginOrEstablish',
  exempt: [`${AUTH}/services/two-factor-challenge.service.ts`],
  captureCall: 'sessionService.readEpoch(userId) (see LoginService.login)',
  hint: 'Read SessionService.readEpoch(userId) before the credential and pass it into the challenge seam.',
  ...SESSION_SCOPE,
});

/*
 * A sign-in can end in more than one place (signed in, 2FA challenge, verify
 * your email), and the client can only route correctly if the response says
 * which. Every door that mints a session is declared here; a new one fails the
 * build until somebody classifies it.
 */
const sessionLandingDeclaredRule = createSessionLandingDeclaredRule({
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
      file: `${AUTH}/services/register.service.ts`,
      landing: 'server-decided',
      because: 'Self-signup has one outcome: a new USER account and the verify-your-email notice.',
    },
    {
      file: `${AUTH}/services/password-change.service.ts`,
      landing: 'reissue',
      because:
        'The caller already holds a session; the re-issue replaces the cookie underneath them and does not navigate.',
    },
    {
      file: `${AUTH}/services/session-management.service.ts`,
      landing: 'reissue',
      because:
        'Same shape as password change: revokeOthers re-issues the caller their own session.',
    },
  ],
  hint: 'The doors are declared in tools/lint-meta/registry.ts. A door that can end a sign-in in more than one place returns ILoginResult.',
  ...SESSION_SCOPE,
});

export const META_RULES: readonly IMetaRule[] = [
  // Auth
  proceduresRequireGuardRule,
  establishSessionCallersRule,
  sessionEpochCapturedRule,
  sessionLandingDeclaredRule,
  // Security
  requiredRulesAtErrorRule,
  rawSqlAllowlistPinnedRule,
  createGithubActionsShaPinnedRule(),
  createGithubActionsLeastPrivilegePermissionsRule(),
  // The gate itself
  createEslintConfigNoWarnRule(),
  createNoInlineLintDisableRule(),
  createNoTsIgnoreRule(),
  tsconfigStrictRule,
];
