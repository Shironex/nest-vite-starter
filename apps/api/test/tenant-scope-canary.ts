/**
 * Test-only seam for the isolation canary.
 *
 * The isolation lane is the only proof that the tenant-scope extension is a
 * real boundary, and many of its cases assert ABSENCE ("resolves to null"),
 * which also passes when a fixture never landed. The canary asks the question
 * the lane cannot ask itself: does it go red when isolation actually breaks?
 *
 * The mutation is a REGISTRY, not a behavior switch. `buildTenantScopeExtension`
 * takes the model map as a parameter (production passes none), so a mutant is
 * the production map minus one model, which is exactly the shape of the real
 * accident this guards against: a scoped model that never reaches the registry,
 * or an accessor-mapping refactor that makes every lookup miss.
 *
 * Three fences keep it away from production:
 *
 *   1. This module lives in `test/`, outside apps/api's tsconfig `rootDir`, so
 *      a `src/` file that imported it would not compile.
 *   2. `resolveCanaryModels` throws unless NODE_ENV is `test`.
 *   3. `ISOLATION_CANARY_DISABLE_MODEL` is `Joi.forbidden()` outside the test
 *      environment (config/configuration.config.ts), so an API process that
 *      sees it set refuses to boot at all.
 */
import {
  TENANT_SCOPED_MODELS,
  buildTenantScopeExtension,
  type TenantScopedModelMap,
} from '@/common/database/tenant-scope.extension';

/** The one env var the canary runner sets; unset everywhere else. */
export const CANARY_ENV_VAR = 'ISOLATION_CANARY_DISABLE_MODEL';

/** Mutant that scopes NOTHING: the "the registry never loaded" accident. */
export const CANARY_DISABLE_ALL = 'all';

/**
 * The model registry the lane's extended client should be built from.
 *
 * Unset (the normal lane run) gives the production registry untouched, so the
 * seam has no effect on an ordinary `pnpm --filter @repo/api test:integration`.
 * Anything else is a mutant and must name a real model, so a typo in the runner
 * cannot quietly produce a suite that only LOOKS like it survived.
 */
export function resolveCanaryModels(
  requested: string | undefined,
  nodeEnv: string | undefined,
): TenantScopedModelMap {
  if (requested === undefined || requested === '') {
    return TENANT_SCOPED_MODELS;
  }
  if (nodeEnv !== 'test') {
    throw new Error(
      `${CANARY_ENV_VAR} disables tenant isolation and is refused outside the test environment (NODE_ENV=${String(nodeEnv)}).`,
    );
  }
  if (requested === CANARY_DISABLE_ALL) {
    return {};
  }
  const known = Object.keys(TENANT_SCOPED_MODELS);
  if (!known.includes(requested)) {
    throw new Error(
      `${CANARY_ENV_VAR}="${requested}" names no model in TENANT_SCOPED_MODELS. Known models: ${known.join(', ')}, or "${CANARY_DISABLE_ALL}".`,
    );
  }
  return Object.fromEntries(
    Object.entries(TENANT_SCOPED_MODELS).filter(([model]) => model !== requested),
  );
}

/**
 * The extended client the isolation specs build, exactly as `PrismaService`
 * builds it, unless the canary runner asked for a mutant registry.
 */
export function buildCanaryTenantScopeExtension() {
  return buildTenantScopeExtension(
    resolveCanaryModels(process.env[CANARY_ENV_VAR], process.env.NODE_ENV),
  );
}
