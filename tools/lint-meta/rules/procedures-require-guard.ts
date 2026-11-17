import type { IMetaCtx, IMetaRule, IViolation } from '@noctcore/harness';

import { readProcedures, type IProcedure, type ISourceFile } from './trpc-procedures';

const RULE_ID = 'procedures-require-guard';

/** Where the routers live. Specs are not served, and they do not match. */
const ROUTER_GLOB = 'apps/api/src/**/*.router.ts';

/*
 * Every tRPC procedure sits behind an auth guard or is listed as public.
 *
 * nestjs-trpc has no global auth: middleware applies per router class or per
 * method. `AuthRouter`, `SessionsRouter` and `TwoFactorRouter` carry no
 * class-level middleware and guard each method one by one, so a new method that
 * forgets `@UseMiddlewares(AuthMiddleware)` ships as a public endpoint. It
 * type-checks and passes the unit tests that call the method directly; if it
 * takes an id and calls a service, it returns data to anyone.
 *
 * So the public surface is a list, not an absence. A procedure passes when an
 * accepted guard appears in `@UseMiddlewares` on its class or its method, or
 * when it is in PUBLIC_PROCEDURES with a reason. An entry that names a
 * procedure no router declares, or one that is guarded, fails too: a
 * stale entry is a pre-approved public slot waiting for the next method of that
 * name. lint-meta sees every router at once, which is what lets it catch that.
 */

/** Middlewares that establish an authenticated caller or reject the request. */
export const GUARDS: readonly string[] = ['AuthMiddleware'];

export interface IPublicProcedure {
  /** The router alias (`@Router({ alias })`), i.e. the first half of the wire path. */
  readonly router: string;
  readonly procedure: string;
  /** Why anonymous callers may reach it. Required: this is the review record. */
  readonly reason: string;
}

/** The whole public tRPC surface. Adding to it is a security review, not a chore. */
export const PUBLIC_PROCEDURES: readonly IPublicProcedure[] = [
  {
    router: 'ping',
    procedure: 'ping',
    reason: 'Liveness echo for the client; reads nothing.',
  },
  {
    router: 'auth',
    procedure: 'register',
    reason: 'Self-signup: the caller has no account yet.',
  },
  {
    router: 'auth',
    procedure: 'login',
    reason: 'Establishes the session; rate-limited and lockout-guarded.',
  },
  {
    router: 'auth',
    procedure: 'verifyTwoFactor',
    reason: 'Pre-session second factor; the pending 2FA cookie authorizes it.',
  },
  {
    router: 'auth',
    procedure: 'forgotPassword',
    reason: 'Locked-out user requests a reset mail; answers identically for unknown emails.',
  },
  {
    router: 'auth',
    procedure: 'resetPassword',
    reason: 'The single-use mailed token is the authorization.',
  },
  {
    router: 'auth',
    procedure: 'resetPasswordTokenState',
    reason: 'Reset-form pre-check on the mailed token; does not consume it.',
  },
  {
    router: 'auth',
    procedure: 'verifyEmail',
    reason: 'Mailed verification link; the clicker may not be signed in.',
  },
  {
    router: 'auth',
    procedure: 'confirmEmailChange',
    reason: 'Link mailed to the new address; the clicker may not be signed in.',
  },
];

export interface IGuardConfig {
  readonly guards: readonly string[];
  readonly publicProcedures: readonly IPublicProcedure[];
}

const DEFAULT_CONFIG: IGuardConfig = { guards: GUARDS, publicProcedures: PUBLIC_PROCEDURES };

function key(router: string, procedure: string): string {
  return `${router}.${procedure}`;
}

function isGuarded(procedure: IProcedure, guards: ReadonlySet<string>): boolean {
  return [...procedure.classMiddlewares, ...procedure.methodMiddlewares].some((name) =>
    guards.has(name),
  );
}

export function checkProceduresRequireGuard(
  files: readonly ISourceFile[],
  config: IGuardConfig = DEFAULT_CONFIG,
): IViolation[] {
  const guards = new Set(config.guards);
  const listed = new Map(
    config.publicProcedures.map((entry) => [key(entry.router, entry.procedure), entry]),
  );
  const seen = new Set<string>();
  const violations: IViolation[] = [];

  for (const entry of config.publicProcedures) {
    if (entry.reason.trim().length === 0) {
      violations.push({
        file: 'tools/lint-meta/rules/procedures-require-guard.ts',
        rule: RULE_ID,
        message: `PUBLIC_PROCEDURES entry ${key(entry.router, entry.procedure)} has no reason. Every public procedure records why anonymous callers may reach it.`,
      });
    }
  }

  for (const file of files) {
    for (const procedure of readProcedures(file)) {
      const id = key(procedure.router, procedure.procedure);
      seen.add(id);
      const where = `${procedure.className}.${procedure.procedure} (${id}) at ${procedure.file}:${String(procedure.line)}`;
      const guarded = isGuarded(procedure, guards);

      if (!guarded && !listed.has(id)) {
        violations.push({
          file: procedure.file,
          rule: RULE_ID,
          message: `${where} has no auth guard, so it ships as a public endpoint. Add @UseMiddlewares(${config.guards.join(' or ')}) on the method or the class, or, if it is public on purpose, list it in PUBLIC_PROCEDURES (tools/lint-meta/rules/procedures-require-guard.ts) with a reason.`,
        });
      }
      if (guarded && listed.has(id)) {
        violations.push({
          file: procedure.file,
          rule: RULE_ID,
          message: `${where} is guarded but still listed in PUBLIC_PROCEDURES. Remove the stale entry so the public list is exactly the public surface.`,
        });
      }
    }
  }

  for (const [id] of listed) {
    if (!seen.has(id)) {
      violations.push({
        file: 'tools/lint-meta/rules/procedures-require-guard.ts',
        rule: RULE_ID,
        message: `PUBLIC_PROCEDURES lists ${id}, which no router declares. Remove the stale entry: it pre-approves the next procedure given that name.`,
      });
    }
  }

  return violations;
}

/** Every tRPC procedure is behind an auth guard or listed as public with a reason. */
export const proceduresRequireGuardRule: IMetaRule = {
  id: RULE_ID,
  category: 'source-text',
  ciCritical: true,
  description: `Every @Query / @Mutation in apps/api *.router.ts must have ${GUARDS.join(' or ')} in @UseMiddlewares (class or method), or be listed in PUBLIC_PROCEDURES with a reason; stale entries fail.`,
  run(ctx: IMetaCtx): IViolation[] {
    return checkProceduresRequireGuard(
      ctx
        .glob(ROUTER_GLOB)
        .sort()
        .map((file) => ({ file, source: ctx.read(file) ?? '' })),
    );
  },
};
