import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../utils/createRule';

export const RULE_NAME = 'effect-fired-mutation-must-bind-callbacks';

export interface EffectFiredMutationMustBindCallbacksOptions {
  /** Hooks whose callback body counts as "fired from an effect". */
  readonly effectHooks?: readonly string[];
  /** Method names that start a TanStack Query mutation. */
  readonly mutateMethods?: readonly string[];
  /** Option keys that only a live observer would deliver. */
  readonly perCallCallbacks?: readonly string[];
}

type RuleOptions = [EffectFiredMutationMustBindCallbacksOptions];
type MessageIds = 'mustBindToMutation';

/*
 * A mutation fired from an effect must carry its handlers on `useMutation`,
 * never as the second argument to `mutate(...)`.
 *
 * TanStack Query delivers a per-call `mutate(vars, { onSuccess })` handler only
 * while the observer that issued the call still has listeners
 * (MutationObserver gates them on `hasListeners()`); the options passed to
 * `useMutation` run off the mutation instance instead and survive whatever
 * happens to the observer. An effect-fired call is exactly the case where that
 * difference bites: React StrictMode's second effect pass, a route transition,
 * or a back-and-forward all detach the observer before a slow server answers.
 * Because such effects are almost always ref-guarded (the request usually costs
 * something: a rate-limit budget, a single-use token), the second pass fires
 * no replacement call, and the screen holds its loading state forever with the
 * failure path swallowed too, so no retry control ever appears.
 *
 * SCOPE IS THE POINT. Per-call callbacks are the right tool from a click or a
 * submit handler, where they close over that one interaction, and this repo
 * uses them in a dozen such places. Only the effect-fired case is reported.
 *
 * KNOWN LIMIT: the check is lexical. A `mutate(vars, { onSuccess })` written in
 * a helper that the effect merely calls is not seen, because following that
 * would need type information the other rules here also do without.
 */
const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    effectHooks: { type: 'array', items: { type: 'string' } },
    mutateMethods: { type: 'array', items: { type: 'string' } },
    perCallCallbacks: { type: 'array', items: { type: 'string' } },
  },
};

const DEFAULT_EFFECT_HOOKS: readonly string[] = ['useEffect', 'useLayoutEffect'];
const DEFAULT_MUTATE_METHODS: readonly string[] = ['mutate', 'mutateAsync'];
const DEFAULT_PER_CALL_CALLBACKS: readonly string[] = ['onSuccess', 'onError', 'onSettled'];

/** `useEffect(...)`, `React.useEffect(...)`. */
function calleeName(node: TSESTree.CallExpression): string | undefined {
  const callee = node.callee;
  if (callee.type === AST_NODE_TYPES.Identifier) return callee.name;
  if (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.property.type === AST_NODE_TYPES.Identifier
  ) {
    return callee.property.name;
  }
  return undefined;
}

function namesAPerCallCallback(
  node: TSESTree.Node | undefined,
  callbackNames: readonly string[],
): boolean {
  if (node?.type !== AST_NODE_TYPES.ObjectExpression) return false;
  return node.properties.some(
    (property) =>
      property.type === AST_NODE_TYPES.Property &&
      !property.computed &&
      property.key.type === AST_NODE_TYPES.Identifier &&
      callbackNames.includes(property.key.name),
  );
}

export const effectFiredMutationMustBindCallbacksRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'A mutation fired from an effect must carry its onSuccess/onError on `useMutation`, not as per-call `mutate()` options, which a detached observer never delivers.',
    },
    schema: [optionSchema],
    messages: {
      mustBindToMutation:
        'Move `{{callback}}` onto the `useMutation({ ... })` options. A per-call `{{method}}(vars, { ... })` handler runs only while the issuing observer still has listeners, so a remount before the server answers drops it and the screen never leaves its loading state.',
    },
  },
  defaultOptions: [
    {
      effectHooks: DEFAULT_EFFECT_HOOKS,
      mutateMethods: DEFAULT_MUTATE_METHODS,
      perCallCallbacks: DEFAULT_PER_CALL_CALLBACKS,
    },
  ],
  create(context, [options]) {
    const effectHooks = options.effectHooks ?? DEFAULT_EFFECT_HOOKS;
    const mutateMethods = options.mutateMethods ?? DEFAULT_MUTATE_METHODS;
    const perCallCallbacks = options.perCallCallbacks ?? DEFAULT_PER_CALL_CALLBACKS;

    // Depth rather than a boolean: effects nest inside other effects' helpers,
    // and every frame below the outermost one is still effect-fired.
    let effectDepth = 0;

    return {
      CallExpression(node): void {
        const name = calleeName(node);
        if (name !== undefined && effectHooks.includes(name)) {
          effectDepth += 1;
          return;
        }
        if (effectDepth === 0) return;
        if (name === undefined || !mutateMethods.includes(name)) return;
        if (node.arguments.length < 2) return;

        const perCallOptions = node.arguments[1];
        if (perCallOptions === undefined) return;
        if (!namesAPerCallCallback(perCallOptions, perCallCallbacks)) return;

        context.report({
          node: perCallOptions,
          messageId: 'mustBindToMutation',
          data: { method: name, callback: perCallCallbacks[0] ?? 'onSuccess' },
        });
      },
      'CallExpression:exit'(node): void {
        const name = calleeName(node);
        if (name !== undefined && effectHooks.includes(name)) {
          effectDepth -= 1;
        }
      },
    };
  },
});
