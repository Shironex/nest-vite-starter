import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../utils/createRule';

export const RULE_NAME = 'trpc-invalidate-with-path-key';

export interface TrpcInvalidateWithPathKeyOptions {
  /** QueryClient methods that take a key filter and reach many cache entries. */
  readonly methods?: readonly string[];
  /** Identifiers that own the tRPC options proxy (`trpc` in `trpc.x.y.queryKey()`). */
  readonly rootIdentifiers?: readonly string[];
}

type RuleOptions = [TrpcInvalidateWithPathKeyOptions];
type MessageIds = 'usePathKey' | 'usePathFilter';

/*
 * A cache-wide operation on a tRPC procedure must address the procedure by its
 * PATH, not by a bare `queryKey()`.
 *
 * `<proc>.queryKey()` with no input is `[path, { type: 'query' }]`. An infinite
 * query (`infiniteQueryOptions`) is keyed `[path, { input, type: 'infinite' }]`,
 * and TanStack's partial match compares the `type` field too, so the bare
 * `queryKey()` prefix-matches nothing infinite. `<proc>.pathKey()` is `[path]`,
 * which matches every entry of the procedure, plain and infinite alike. For a
 * plain query the two are equivalent, so the swap is safe and mechanical, and
 * it removes a trap: the day a list is moved to `useInfiniteQuery`, every
 * `invalidateQueries({ queryKey: trpc.list.queryKey() })` stops working, with
 * nothing pointing at the call sites and unit tests that mock the client still
 * passing. (The compliance agenda shipped exactly that bug: the snooze reached
 * the server and the row on screen never changed.)
 *
 * A key WITH an input is exact on purpose (one entry) and stays allowed.
 * `setQueryData` / `getQueryData` are out of scope: they address one entry.
 * A filter that also carries `exact` is left alone, because `exact: true`
 * against `[path]` would match nothing and the swap would not be equivalent.
 *
 * KNOWN LIMIT: the check is lexical. A key built in a variable first
 * (`const key = trpc.x.queryKey(); client.invalidateQueries({ queryKey: key })`)
 * is not seen, and neither is a root reached through `this.` or a call.
 */
const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    methods: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    rootIdentifiers: { type: 'array', items: { type: 'string' }, uniqueItems: true },
  },
};

const DEFAULT_METHODS: readonly string[] = [
  'invalidateQueries',
  'refetchQueries',
  'cancelQueries',
  'removeQueries',
  'resetQueries',
];

const DEFAULT_ROOT_IDENTIFIERS: readonly string[] = ['trpc'];

/** The name of a non-computed `.name` member or an `name:` object key. */
function staticName(
  node: TSESTree.Expression | TSESTree.PrivateIdentifier | TSESTree.PropertyName,
  computed: boolean,
): string | undefined {
  if (!computed && node.type === AST_NODE_TYPES.Identifier) return node.name;
  if (node.type === AST_NODE_TYPES.Literal && typeof node.value === 'string') return node.value;
  return undefined;
}

/** The identifier at the bottom of `trpc.a.b.c`, or undefined for any other shape. */
function rootIdentifier(node: TSESTree.Expression): string | undefined {
  let current: TSESTree.Node = node;
  while (
    current.type === AST_NODE_TYPES.MemberExpression ||
    current.type === AST_NODE_TYPES.TSNonNullExpression
  ) {
    current =
      current.type === AST_NODE_TYPES.MemberExpression ? current.object : current.expression;
  }
  return current.type === AST_NODE_TYPES.Identifier ? current.name : undefined;
}

interface IKeyCall {
  /** The `queryKey` / `queryFilter` identifier to rewrite. */
  readonly method: TSESTree.Identifier;
  readonly root: string;
}

/**
 * `<root>.a.b.<methodName>()` with NO arguments, where the method identifier is
 * the fix target. Anything with an argument is an exact key and is left alone.
 */
function inputlessCall(
  node: TSESTree.Node,
  methodName: string,
  roots: ReadonlySet<string>,
): IKeyCall | undefined {
  if (node.type !== AST_NODE_TYPES.CallExpression || node.arguments.length > 0) return undefined;
  const callee = node.callee;
  if (callee.type !== AST_NODE_TYPES.MemberExpression || callee.computed) return undefined;
  if (callee.property.type !== AST_NODE_TYPES.Identifier) return undefined;
  if (callee.property.name !== methodName) return undefined;
  const root = rootIdentifier(callee.object);
  if (root === undefined || !roots.has(root)) return undefined;
  return { method: callee.property, root };
}

export const trpcInvalidateWithPathKeyRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    fixable: 'code',
    docs: {
      description:
        'Require `pathKey()` when a tRPC procedure is invalidated, refetched, canceled, removed or reset without an input. A bare `queryKey()` misses infinite queries.',
    },
    schema: [optionSchema],
    messages: {
      usePathKey:
        "Use `{{root}}...pathKey()` here. An input-less `queryKey()` is `[path, { type: 'query' }]` and prefix-matches no infinite query, so this call goes silently dead the day the procedure moves to `useInfiniteQuery`. `pathKey()` is `[path]` and reaches every entry.",
      usePathFilter:
        "Use `{{root}}...pathFilter()` here. An input-less `queryFilter()` carries `[path, { type: 'query' }]` and prefix-matches no infinite query; `pathFilter()` reaches every entry of the procedure.",
    },
  },
  defaultOptions: [
    {
      methods: [...DEFAULT_METHODS],
      rootIdentifiers: [...DEFAULT_ROOT_IDENTIFIERS],
    },
  ],
  create(context, [options]) {
    const methods = new Set(options.methods ?? DEFAULT_METHODS);
    const roots = new Set(options.rootIdentifiers ?? DEFAULT_ROOT_IDENTIFIERS);

    return {
      CallExpression(node): void {
        // Match by method name, not receiver, so a `sharedQueryClient` imported
        // from a module (not just a local `queryClient`) is covered too.
        const callee = node.callee;
        if (callee.type !== AST_NODE_TYPES.MemberExpression) return;
        const calleeName = staticName(callee.property, callee.computed);
        if (calleeName === undefined || !methods.has(calleeName)) return;

        const filters = node.arguments[0];
        if (filters === undefined) return;

        // `invalidateQueries(trpc.x.queryFilter())`
        const filterCall = inputlessCall(filters, 'queryFilter', roots);
        if (filterCall !== undefined) {
          context.report({
            node: filterCall.method,
            messageId: 'usePathFilter',
            data: { root: filterCall.root },
            fix: (fixer) => fixer.replaceText(filterCall.method, 'pathFilter'),
          });
          return;
        }

        // `invalidateQueries({ queryKey: trpc.x.queryKey() })`
        if (filters.type !== AST_NODE_TYPES.ObjectExpression) return;

        let keyValue: TSESTree.Node | undefined;
        let hasExact = false;
        for (const property of filters.properties) {
          if (property.type !== AST_NODE_TYPES.Property) continue;
          const name = staticName(property.key, property.computed);
          if (name === 'exact') hasExact = true;
          if (name === 'queryKey') keyValue = property.value;
        }
        if (keyValue === undefined || hasExact) return;

        const keyCall = inputlessCall(keyValue, 'queryKey', roots);
        if (keyCall === undefined) return;

        context.report({
          node: keyCall.method,
          messageId: 'usePathKey',
          data: { root: keyCall.root },
          fix: (fixer) => fixer.replaceText(keyCall.method, 'pathKey'),
        });
      },
    };
  },
});
