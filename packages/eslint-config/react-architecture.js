import codeQuality from '@noctcore/eslint-plugin-code-quality';
import noctcoreReact from '@noctcore/eslint-plugin-react';
import architecture from '@noctcore/eslint-plugin-architecture';
import query from '@noctcore/eslint-plugin-query';

/*
 * Frontend component-architecture rules, sourced from the
 * published @noctcore/eslint-plugin-{react,architecture,code-quality} packages
 * with option objects that reproduce this repo's prior defaults. The structural
 * rules are scoped to `src/features/**` because that is where the
 * per-component-folder convention lives: route seams, stores, and lib code are
 * deliberately not gated. `@repo/ui` has no `src/features/` dir, so spreading
 * this config there activates only `interface-prefix-i` (below) and leaves the
 * structural rules inert. Severity is error-or-off, never warn.
 *
 * The noctcore react plugin is registered under the `noctcore-react` namespace,
 * not `react`, so it never collides with `eslint-plugin-react` (registered as
 * `react` in ./react.js, which apps/web and @repo/ui also spread).
 *
 * ignorePaths globs are matched by the noctcore rules against the absolute
 * filename, so the previously repo-root-relative `packages/ui/**` is anchored
 * here as `**\/packages/ui/**`.
 */
const FEATURE_FILES = ['src/features/**/*.{ts,tsx}'];

/*
 * Stories and tests live alongside the component but are not the component:
 * they legitimately map over variants and render fixtures, so the JSX/cross
 * -feature rules must not gate them. The component-only rules already key off a
 * single-segment PascalCase `.tsx`, so these sidecars are doubly safe.
 */
const SIDECAR_FILES = ['src/features/**/*.test.{ts,tsx}'];

const COMPONENT_IGNORE_PATHS = ['**/packages/ui/**', '**/components/ui/**'];

// Local rule matched `*.hooks.tsx` too via a `\.(queries|hooks|mutations)\.tsx?$`
// regex; the noctcore default only covers the `.ts` variants, so the `.tsx`
// suffixes are added back to preserve coverage.
const HOOK_BUCKET_SUFFIXES = [
  '.hooks.ts',
  '.queries.ts',
  '.mutations.ts',
  '.hooks.tsx',
  '.queries.tsx',
  '.mutations.tsx',
];

const NON_VISUAL_PROP_NAMES = [
  '^userId$',
  '^userIds$',
  '^currentUser',
  '^sessionId$',
  'token',
  'jwt',
  'secret',
  'apiKey',
  'credential',
];

/** @type {import("eslint").Linter.Config[]} */
export const config = [
  {
    files: FEATURE_FILES,
    ignores: SIDECAR_FILES,
    plugins: {
      'noctcore-react': noctcoreReact,
      architecture,
    },
    rules: {
      'architecture/component-folder-structure': [
        'error',
        {
          componentRoot: 'src/features',
          requiredSiblings: ['.hooks.ts', '.types.ts', '.test.tsx', 'index.ts'],
          ignorePaths: COMPONENT_IGNORE_PATHS,
        },
      ],
      'architecture/no-cross-feature-imports': [
        'error',
        {
          featureRoot: 'src/features',
          alias: '@/features',
          sharedFeatures: ['shared'],
        },
      ],
      'noctcore-react/max-hooks-per-file': ['error', { fileSuffixes: HOOK_BUCKET_SUFFIXES }],
      'noctcore-react/no-state-in-component-body': 'error',
      'noctcore-react/no-jsx-computation': 'error',
      'noctcore-react/props-must-be-visual': ['error', { denyPropNames: NON_VISUAL_PROP_NAMES }],
      'architecture/index-must-reexport-default': [
        'error',
        { ignorePaths: COMPONENT_IGNORE_PATHS },
      ],
    },
  },
  /*
   * React correctness rules that are not about folder structure, so they cover
   * all of `src/` (apps/web and `@repo/ui` both spread this config) rather than
   * `src/features/**`. Each reports 0 hits on this tree:
   *   - `no-effect-derived-state`: state set from props or other state inside
   *     an effect renders once stale, then again; derive it during render.
   *   - `prefer-lazy-state-init`: `useState(JSON.parse(...))` re-parses on every
   *     render and throws the result away; pass an initializer function.
   *   - `no-jsx-in-hooks`: a hook returning JSX is a component in disguise, and
   *     the `.hooks.ts` / component split this repo enforces stops meaning
   *     anything once hooks render.
   *   - `require-effect-cancellation`: a state update after an await inside an
   *     effect, with no AbortController, cancel flag or cleanup, lands on a
   *     component that may have unmounted or moved on to newer inputs.
   *   - `no-unguarded-web-storage`: reading or writing `localStorage` /
   *     `sessionStorage` throws outright when storage is disabled, partitioned
   *     or full, and a `typeof window` check guards server rendering rather
   *     than that throw. The three production call sites here already sit
   *     inside `try` blocks, so the rule only holds the line.
   */
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'noctcore-react': noctcoreReact,
    },
    rules: {
      'noctcore-react/no-effect-derived-state': 'error',
      'noctcore-react/prefer-lazy-state-init': 'error',
      'noctcore-react/no-jsx-in-hooks': 'error',
      'noctcore-react/require-effect-cancellation': 'error',
      'noctcore-react/no-unguarded-web-storage': 'error',
    },
  },
  /*
   * `interface-prefix-i` is not a component-folder rule: it governs every
   * interface in the package, so it gets a broad `src/**` glob rather than the
   * `src/features/**` scope above. `@repo/ui` spreads this same config to pick
   * up only this rule. The rule self-exempts `declare module`/`declare global`
   * augmentations; generated files such as `routeTree.gen.ts` are excluded via
   * each package's flat-config ignores.
   */
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'code-quality': codeQuality,
    },
    rules: {
      'code-quality/interface-prefix-i': 'error',
    },
  },
  /*
   * A mutation fired from an effect must carry its handlers on `useMutation`,
   * because TanStack Query delivers a per-call `mutate(vars, { onSuccess })`
   * handler only while the issuing observer still has listeners. Any remount
   * before the server answers (StrictMode's second effect pass, a route
   * transition, a back-and-forward) detaches that observer, and since such
   * effects are ref-guarded against a duplicate request there is no second call
   * to arrive either: the screen holds its spinner with the failure path
   * swallowed too, so no retry control appears.
   *
   * `.ts` as well as `.tsx`, because the hook buckets where this shape lives
   * are `.hooks.ts`. Sidecars are included on purpose: a test or a story that
   * reproduces the bad shape is teaching it.
   */
  {
    files: ['src/features/**/*.{ts,tsx}'],
    plugins: {
      'noctcore-query': query,
    },
    rules: {
      'noctcore-query/effect-fired-mutation-must-bind-callbacks': 'error',
    },
  },
  /*
   * Invalidating (or refetching, canceling, removing, resetting) a tRPC
   * procedure with no input must use `pathKey()`. A bare `queryKey()` is
   * `[path, { type: 'query' }]`, which prefix-matches no infinite query, so
   * the call dies silently the day the procedure moves to `useInfiniteQuery`
   * (a shipped bug that only e2e caught). `pathKey()` is `[path]` and
   * reaches every entry; for a plain query the two are equivalent. Autofixable.
   * Sidecars are included on purpose: a test that reproduces the bad shape is
   * teaching it.
   */
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'noctcore-query': query,
    },
    rules: {
      'noctcore-query/trpc-invalidate-with-path-key': 'error',
    },
  },
];
