/*
 * The seam between this repo's rules and `@noctcore/harness`, which runs them.
 *
 * `pnpm lint:meta` is `harness lint-meta --registry tools/lint-meta/registry.ts`,
 * and `pnpm generate:lint-meta-docs` is `harness catalog` on the same registry.
 * The harness owns the run loop, the per-rule isolation, the reporter and the
 * exit code. This file owns the three things SaaS Starter decides for itself:
 *
 * 1. How a local rule gets the richer context it was written against
 *    (`adoptLocalRule`). The harness hands every rule its portable `IMetaCtx`;
 *    30-odd rules here also read the pre-collected `sourceFiles` and
 *    `workflowFiles`, so the adopted rule builds `IMetaContext` from the
 *    harness's root, once per run, and hands that on. The rule body is
 *    untouched.
 * 2. That no rule in this registry can be non-blocking
 *    (`assertEveryRuleBlocks`). The harness reds the build only for a
 *    `ciCritical` rule and prints the rest as `[info]`, so a rule that lost the
 *    flag would go silently non-blocking. So the registry refuses to LOAD with such a
 *    rule in it, and the harness exits 1 on a registry that fails to load: the
 *    run fails closed, naming the rule, before any rule runs.
 * 3. That no ratcheting rule is admitted (`adoptHarnessRule`,
 *    `assertEveryRuleBlocks`). A `baseline` grandfathers today's offenders.
 *    Every rule here is strict and the tree is clean against all of them, so a
 *    ratchet would only add a second, editable place for debt to hide.
 */
import type { IMetaCtx, IMetaRule as IHarnessMetaRule } from '@noctcore/harness';

import { buildContext } from './context';
import type { IMetaContext, IMetaRule } from './types';

export type { IHarnessMetaRule };

/** Fails to compile unless `T` is `true`. */
type Assert<T extends true> = T;

/**
 * The superset still holds: a local rule's context carries everything the
 * harness context does, so an upstream rule loses nothing when it runs on one
 * (the codegen test does exactly that).
 */
export type ContextIsHarnessSuperset = Assert<IMetaContext extends IMetaCtx ? true : never>;

/** Whether a context is already this repo's full one (a test built it), not the harness's. */
function isLocalContext(ctx: IMetaCtx): ctx is IMetaContext {
  const candidate = ctx as Partial<IMetaContext>;

  return Array.isArray(candidate.sourceFiles) && Array.isArray(candidate.workflowFiles);
}

/*
 * One `IMetaContext` per harness context. The harness builds a single context
 * for a whole run, so this collects the source tree once per run, not once per
 * rule, which is what keeps `pnpm lint:meta` cheap enough for pre-push. Keyed
 * weakly on the harness's object rather than on the root, so a second run in
 * the same process (a test writing files between two runs) walks the tree again.
 */
const LOCAL_CONTEXTS = new WeakMap<IMetaCtx, IMetaContext>();

function localContext(ctx: IMetaCtx): IMetaContext {
  if (isLocalContext(ctx)) {
    return ctx;
  }

  const cached = LOCAL_CONTEXTS.get(ctx);
  if (cached !== undefined) {
    return cached;
  }

  const built = buildContext(ctx.root);
  LOCAL_CONTEXTS.set(ctx, built);
  return built;
}

/**
 * Load a rule written against this repo's `IMetaRule` into the harness.
 *
 * Both passes are carried over and each is handed the local context. The
 * `ciCritical` flag is carried over AS DECLARED, not forced: a local rule that
 * dropped it must stop the registry loading (`assertEveryRuleBlocks`), not be
 * quietly repaired.
 */
export function adoptLocalRule(rule: IMetaRule): IHarnessMetaRule {
  const { run, runAsync } = rule;
  const adopted: IHarnessMetaRule = {
    id: rule.id,
    category: rule.category,
    description: rule.description,
  };

  if (rule.ciCritical !== undefined) {
    adopted.ciCritical = rule.ciCritical;
  }
  if (run !== undefined) {
    adopted.run = (ctx) => run(localContext(ctx));
  }
  if (runAsync !== undefined) {
    adopted.runAsync = (ctx) => runAsync(localContext(ctx));
  }

  return adopted;
}

/**
 * Load an upstream rule (`@noctcore/lint-meta-rules`) into this registry.
 *
 * `ciCritical` is forced on: every rule in this registry blocks, whatever the
 * factory's default is today or becomes in a later release.
 *
 * A rule carrying a `baseline` is rejected rather than adopted. That is the
 * harness's ratchet hook, and this registry admits strict rules only.
 */
export function adoptHarnessRule(rule: IHarnessMetaRule): IHarnessMetaRule {
  if (rule.baseline !== undefined) {
    throw new Error(
      `Harness rule "${rule.id}" declares a baseline, and this registry admits strict rules only. Drop the baseline and fix the offenders, or leave the rule out.`,
    );
  }

  return { ...rule, ciCritical: true };
}

/**
 * The registry's load-time guard: every rule blocks, none ratchets, no id repeats.
 *
 * It throws, and it runs when the registry module is imported, so the harness
 * reports "Failed to load the lint-meta registry" and exits 1. That is the
 * failure mode on purpose: a rule that would have gone non-blocking stops the
 * whole run loudly instead of reporting as `[info]` behind a green build.
 */
export function assertEveryRuleBlocks(
  rules: readonly IHarnessMetaRule[],
): readonly IHarnessMetaRule[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const rule of rules) {
    if (rule.ciCritical !== true) {
      problems.push(
        `"${rule.id}" is not ciCritical, so the harness would only print its violations as [info]`,
      );
    }
    if (rule.baseline !== undefined) {
      problems.push(`"${rule.id}" declares a baseline, and this registry admits strict rules only`);
    }
    if (seen.has(rule.id)) {
      problems.push(`"${rule.id}" is registered twice`);
    }
    seen.add(rule.id);
  }

  if (problems.length > 0) {
    throw new Error(
      `tools/lint-meta/registry.ts refuses to load: ${problems.join('; ')}. See tools/lint-meta/harness.ts.`,
    );
  }

  return rules;
}
