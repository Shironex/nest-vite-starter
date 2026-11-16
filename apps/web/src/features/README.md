# Frontend feature architecture

App UI lives in feature folders under `src/features/<domain>/`. Each domain owns
its components, and every component is a folder with a fixed sibling set. The
structure is enforced by lint rules (see "Enforcement" below), so this is the
shape the codebase must keep, not a suggestion.

## Domains

Each top-level folder under `src/features/` is a domain. The list is **generated**, not kept here:
the table in this README once named seven domains while seventeen directories shipped, so the
inventory now lives on the Module Map page
(`docs/architecture/module-map.md`), with one hand-written purpose line per
domain, the file counts, and every cross-domain import with a `file:line` witness. Regenerate it
with `pnpm generate:arch-map`; `lint:meta` fails when it is stale or when a new domain has no
purpose line in `tools/arch/registry.ts`.

A component imports freely from its own domain and from `shared`. Importing
across two sibling domains (for example `settings` reaching into `auth`) is a
lint error (`no-cross-feature-imports`). If two domains need the same component,
it belongs in `shared`.

## Component folder (the sibling set)

Every component is a PascalCase folder under `<domain>/components/<Name>/` with
exactly these files:

```
LoginForm/
  LoginForm.tsx          # thin presentational shell (the default export)
  LoginForm.hooks.ts     # all state, effects, queries, mutations, store reads
  LoginForm.types.ts     # I-prefixed interfaces (ILoginFormView, ...)
  LoginForm.test.tsx     # component test
  index.ts               # barrel: re-exports the default + the types
```

Responsibilities:

- **`<Name>.tsx`** is a thin shell. It calls exactly one view hook from
  `<Name>.hooks.ts` and renders. It must not call React state/effect hooks
  (`useState`, `useEffect`, `useRef`, ...), data hooks (`useQuery`,
  `useMutation`), or a Zustand `use*Store` directly. It must not compute in JSX
  (no `.map`/`.filter`/arithmetic/chained `&&` inside the returned markup); lift
  those into a `const` above the `return` or into the hook.
- **`<Name>.hooks.ts`** owns everything stateful. It exposes a view hook
  (`use<Name>`) returning a typed view object, plus any sub-hooks. A hook bucket
  file exports at most four `use*` functions.
- **`<Name>.types.ts`** holds the component's interfaces. Every interface is
  prefixed with `I` (`ILoginFormProps`, `ILoginFormView`).
- **`index.ts`** re-exports the default as a named export and the types:
  ```ts
  export { default as LoginForm } from './LoginForm';
  export * from './LoginForm.types';
  ```

Props are visual. A component never takes a secret-shaped prop (`token`,
`userId`, `sessionId`, ...); read those from the route or a store inside the
hook instead (`props-must-be-visual`).

## Copy (`*.strings.ts`)

The app ships in English only and has no i18n framework. A feature that ships
user-facing copy owns one `<Name>.strings.ts` at the feature root: a plain
`as const` object, with a small function for any entry that interpolates a value
or pluralizes.

```
workspace/
  Workspace.strings.ts   # export const workspaceStrings = { ... } as const
  components/
  Workspaces.queries.ts
```

```ts
// Workspace.strings.ts
export const workspaceStrings = {
  title: 'Workspaces',
  list: {
    editFor: ({ name }: { name: string }) => `Edit ${name}`,
  },
} as const;
```

Components and hooks import the table and read it directly
(`workspaceStrings.list.editFor({ name })`). `pnpm new:feature` scaffolds the
file.

Rules:

- A feature never imports another feature's strings: that is
  `no-cross-feature-imports`, same as any other cross-domain import. Copy shared
  by two domains goes in `src/lib/strings.ts` (`commonStrings`).
- Error copy is not per-feature. `errorStrings` in `src/lib/strings.ts` is keyed
  by `AppErrorCode` and `satisfies Record<AppErrorCode, string>`, so a missing or
  misspelled code is a compile error. Use `translateAppError` from
  `@/lib/trpc-errors` to turn a caught error into a sentence, in or out of React.
- A lookup by a runtime key (a role, a status, an audit action) goes through
  `labelFor` in `src/lib/strings.ts`, which falls back to the key itself.
- Dates, numbers, and money go through `@/lib/format`, which formats in
  `APP_LOCALE` from `@repo/shared/constants` (`en-US`, so `MM/dd/yyyy`; change
  that one constant to change every formatter). `formatCurrency` delegates to `formatMoney` in
  `@repo/shared/money`: never write a second currency formatter.

## Routes are seams

Files under `src/routes/` stay thin: a `createFileRoute` that renders a feature
component and wires layout. Logic belongs in the feature's hook, not the route.
The structural rules deliberately do not gate `src/routes/`, `src/stores/`, or
`src/lib/`.

## `@repo/ui` keeps the shadcn convention

The design-system package `@repo/ui` is not a feature and does not use this
folder layout. It keeps the shadcn convention: one kebab-case file per component
with per-subpath exports (`@repo/ui/button`). The component-folder rules ignore
it. The one rule it shares is `interface-prefix-i`: interfaces in `@repo/ui` are
also `I`-prefixed.

## Enforcement

These rules come from the published `@noctcore/eslint-plugin-react`,
`@noctcore/eslint-plugin-architecture`, and `@noctcore/eslint-plugin-code-quality`
packages (they used to live in this repo's `@repo/eslint-plugin-repo`), wired via
`@repo/eslint-config/react-architecture`, and run at `error`:

- `component-folder-structure` - the sibling set must be present
- `no-cross-feature-imports` - no imports across sibling domains
- `max-hooks-per-file` - at most four `use*` exports per hook file
- `no-state-in-component-body` - no raw state/data/store hooks in `<Name>.tsx`
- `no-jsx-computation` - no computation in the returned JSX
- `props-must-be-visual` - no secret-shaped props
- `index-must-reexport-default` - barrels re-export the default
- `interface-prefix-i` - every interface is `I`-prefixed (apps/web + @repo/ui)

## Scaffolding

Generate the boilerplate instead of writing it by hand:

```bash
pnpm new:feature <Name>                 # a new domain folder under features/
pnpm new:component <feature>/<Name>     # a component folder (full sibling set)
pnpm new:component ui/<Name>            # a kebab-case shadcn component in @repo/ui
```

The generated files are template-native: tRPC `queryOptions`/`mutationOptions`,
TanStack file routing, `I`-prefixed interfaces, and the shared `cn` helper.

## Cache invalidation

Invalidate a tRPC procedure with no input by its path: `queryClient.invalidateQueries({ queryKey:
trpc.<router>.<proc>.pathKey() })` (or `pathFilter()`), never a bare `queryKey()`. An input-less
`queryKey()` is `[path, { type: 'query' }]` and matches no infinite query, so the invalidation dies
silently once the procedure moves to `useInfiniteQuery`; `pathKey()` is `[path]` and reaches both.
`repo/trpc-invalidate-with-path-key` enforces this and autofixes it. A key with an input is exact on
purpose and stays as is (`setQueryData(trpc.x.list.queryKey({}), ...)`).
