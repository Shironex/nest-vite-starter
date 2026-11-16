---
title: Feature Folder Architecture
description: The features/<domain>/components/<Name>/ eight-file component convention, the ESLint rules that enforce it, and the codegen commands that scaffold it.
sidebar:
  order: 2
---

This document describes the structural convention `apps/web/src` is built on.
The canonical source is `apps/web/src/features/README.md`: this page expands
on it with the enforcing lint rules and the exact codegen output. If that
README and this page ever disagree, the README (checked into the app) wins.

## Domains

Every top-level folder under `src/features/` is a domain. As of this writing:

| Domain          | Owns                                                        |
| --------------- | ----------------------------------------------------------- |
| `auth`          | Sign in / register / verify / reset, Turnstile, auth layout |
| `dashboard`     | The authenticated landing page and its widgets              |
| `desktop`       | Electron-only chrome (title bar, update banner)             |
| `layout`        | App shell: sidebar, nav, connection indicator               |
| `notifications` | Realtime notification bell and items                        |
| `settings`      | Profile, password, theme, and update settings sections      |
| `shared`        | Components used by more than one domain                     |

A component may import freely from its own domain and from `shared`. Importing
across two sibling domains (e.g. `settings` reaching into `auth`) is a lint
error (`repo/no-cross-feature-imports`). If two domains need the same
component, it belongs in `shared` instead.

`src/routes/`, `src/stores/`, and `src/lib/` are deliberately **not** gated by
these rules, routes stay thin seams (a `createFileRoute` that renders a
feature component), and stores/lib are cross-cutting by design.

## The component folder (the sibling set)

Every component is a PascalCase folder under `<domain>/components/<Name>/`
with exactly six files (a seventh, `<Name>.hooks.test.tsx`, is added when the
hook needs its own dedicated test, see the testing doc):

```
LoginForm/
  LoginForm.tsx          # thin presentational shell (the default export)
  LoginForm.hooks.ts     # all state, effects, queries, mutations, store reads
  LoginForm.types.ts     # I-prefixed interfaces (ILoginFormView, ...)
  LoginForm.stories.tsx  # Storybook story
  LoginForm.test.tsx     # component test
  index.ts               # barrel: re-exports the default + the types
```

This is real code from the repo, `apps/web/src/features/auth/components/LoginForm/`:

```ts
// LoginForm.types.ts
export interface ILoginFormView {
  readonly form: UseFormReturn<LoginInput>;
  readonly onSubmit: (data: LoginInput) => void;
  readonly serverError: string | null;
  readonly isPending: boolean;
}
```

```ts
// index.ts
export { default as LoginForm } from './LoginForm';
export * from './LoginForm.types';
```

```tsx
// LoginForm.tsx (excerpt), a thin shell: one hook call, no state/effects, no
// computation in JSX.
export default function LoginForm() {
  const { form, onSubmit, serverError, isPending } = useLoginForm();

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
        {serverError && <FormError>{serverError}</FormError>}
        {/* ...fields... */}
      </form>
    </Form>
  );
}
```

### File responsibilities

- **`<Name>.tsx`**: thin shell. Calls exactly one view hook from
  `<Name>.hooks.ts` and renders. It must not call React state/effect hooks
  (`useState`, `useEffect`, `useRef`, ...), data hooks (`useQuery`,
  `useMutation`), or a Zustand `use*Store` directly. It must not compute in
  JSX (no `.map`/`.filter`/arithmetic/chained `&&` inside the returned
  markup), lift those into a `const` above the `return`, or into the hook.
- **`<Name>.hooks.ts`**: owns everything stateful. Exposes a view hook
  (`use<Name>`) returning a typed view object, plus any sub-hooks. A hook
  bucket file exports at most four `use*` functions. Purely presentational
  components (e.g. `FormError`, `FormSuccess`) still keep this file, exporting
  nothing (`export {};`) purely to satisfy the sibling-set rule.
- **`<Name>.types.ts`**: the component's interfaces, every one `I`-prefixed
  (`ILoginFormProps`, `ILoginFormView`).
- **`<Name>.stories.tsx`**: Storybook stories (`title: '<domain>/<Name>'`).
- **`<Name>.test.tsx`**: the component test. By convention it **mocks** the
  component's own `.hooks.ts` module so the rendered markup is deterministic
  and offline; see `frontend-testing.md` for why and for the companion
  `.hooks.test.tsx` pattern that exercises the real hook.
- **`index.ts`**: barrel: re-exports the default as a named export, plus the
  types:
  ```ts
  export { default as ComponentName } from './ComponentName';
  export * from './ComponentName.types';
  ```

Props are visual only. A component never takes a secret-shaped prop (`token`,
`userId`, `sessionId`, ...), those are read from the route's search params or
a store inside the hook instead (enforced by `repo/props-must-be-visual`). For
example `ResetPasswordForm.hooks.ts` reads the reset token via
`getRouteApi('/auth/reset-password').useSearch()`, not a prop.

## `@repo/ui` is exempt from the folder convention

`packages/ui` is not a feature and does not use this folder layout, it keeps
the shadcn convention of one kebab-case file per component with per-subpath
package exports (`@repo/ui/button`). The structural rules below ignore it. The
only rule it shares is `interface-prefix-i`.

## Enforcement: `@repo/eslint-plugin-repo` rules

The rules live in `packages/eslint-plugin-repo/src/rules/` and are wired for
`apps/web` via `packages/eslint-config/react-architecture.js`, which every
consuming package's `eslint.config.*` spreads in. They apply to
`src/features/**/*.{ts,tsx}`, excluding `*.stories.{ts,tsx}` and
`*.test.{ts,tsx}` sidecars (those legitimately map over variants/fixtures).
All run at `error`, never `warn`:

| Rule                          | Enforces                                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `component-folder-structure`  | The sibling set must be present for every component folder                                                                                                                                              |
| `no-cross-feature-imports`    | No imports across sibling domains (only same-domain or `shared`)                                                                                                                                        |
| `max-hooks-per-file`          | At most four `use*` exports per hook bucket file                                                                                                                                                        |
| `no-state-in-component-body`  | No raw React state/data/store hooks in `<Name>.tsx`                                                                                                                                                     |
| `no-jsx-computation`          | No computation (`.map`/`.filter`/arithmetic/`&&` chains) in returned JSX                                                                                                                                |
| `props-must-be-visual`        | No secret-shaped props (`token`, `userId`, `sessionId`, ...)                                                                                                                                            |
| `index-must-reexport-default` | Barrels re-export the default plus the types                                                                                                                                                            |
| `interface-prefix-i`          | Every interface is `I`-prefixed, scoped broadly to `src/**/*.{ts,tsx}` in both `apps/web` and `@repo/ui` (not just `src/features/**`), and self-exempts `declare module`/`declare global` augmentations |

`interface-prefix-i` is the one rule that is **not** folder-specific: it
governs every interface in the package (see
`packages/eslint-config/react-architecture.js`), which is why `@repo/ui` picks
it up even though the other seven rules stay inert there (no `src/features/`
directory to match).

Two further rules from the same plugin are wired in the same config file but
with their own scopes:

| Rule                      | Scope                                            | Enforces                                                                                                        |
| ------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `no-hardcoded-ui-strings` | `src/features/**/*.tsx`, translated folders only | Visible copy comes from the i18n catalogs, never from a JSX literal                                             |
| `no-native-date-input`    | `src/**/*.tsx` in `apps/web` and `@repo/ui`      | No `<input type="date">` (or `datetime-local` / `month` / `week`); use `@/features/shared/components/DateField` |

`no-native-date-input` exists because the defect it prevents is invisible in
review. Chromium takes a native date input's display format from the
**browser's UI language** and ignores both the element's `lang` attribute and
the browsing context's locale, so a day-first page served with
`<html lang="en-GB">` still renders `03/04/2026` month-first on a Chrome
installed in US English, and 3 April cannot be told from 4 March. In a business app a date is often a deadline. `DateField` (`packages/ui/src/components/date-field.tsx`, wrapped for
the app in `apps/web/src/features/shared/components/DateField/`) holds the same
`yyyy-MM-dd` value the native control did, so swapping one for the other leaves
schemas and form wiring untouched.

Each rule has a matching unit test in
`packages/eslint-plugin-repo/tests/rules/*.test.ts` using the shared
`ruleTester` helper in `tests/test-utils/ruleTester.ts`.

## Scaffolding (codegen)

Generate the boilerplate instead of writing it by hand, the generators live
in `tools/codegen/` (`new-feature.ts`, `new-component.ts`, shared helpers in
`codegen-utils.ts`) and are wired as root `package.json` scripts:

```bash
pnpm new:feature <Name>                 # a new domain folder under features/
pnpm new:component <feature>/<Name>     # a component folder (full sibling set)
pnpm new:component ui/<Name>            # a kebab-case shadcn component in @repo/ui
```

### `pnpm new:feature <Name>`

Creates `apps/web/src/features/<kebab-name>/` with the feature-root files
(no `components/` subfolder yet, add those with `new:component`):

- `<Name>.types.ts`: an `I<Name>View` placeholder interface.
- `<Name>.queries.ts`: a `use<Name>()` query hook stub that starts from
  `trpc.user.me.queryOptions()` with a `TODO` to swap in the feature's real
  procedure (mirrors the pattern in `features/dashboard/Dashboard.queries.ts`).
- `<Name>.mutations.ts`: a `use<Name>Mutation()` stub, same TODO pattern.
- `<Name>.constants.ts`: a frozen `<SCREAMING_SNAKE>_CONSTANTS` object.
- `locales/en.json`: the namespace's English catalog, starting with a `title`.
- `<Name>.i18n.ts`: the `registerFeatureNamespace(name, { en })` call plus the `<SCREAMING_SNAKE>_NS` export, mirroring
  `features/audit/Audit.i18n.ts`. Generated rather than printed for you to
  write by hand: a catalog nobody registers renders raw keys.

Fails loudly if the feature directory already exists. It prints one follow-up it
deliberately does not do for you: adding the feature's row to the web features
inventory page, which `lint:meta`'s `docs-feature-inventory-complete` requires.

### `pnpm new:component <feature>/<Name>`

Requires the target feature directory to already exist (fails with a
pointer to `pnpm new:feature <feature>` otherwise). Writes the full
six-file sibling set under `apps/web/src/features/<feature>/components/<Name>/`:
a thin `.tsx` shell that calls `use<Name>()` and renders `label`, a
`.hooks.ts` stub, `.types.ts` with `I<Name>View`, a `.stories.tsx` with one
`Default` story, a `.test.tsx` that renders and asserts the rendered copy,
and the re-export barrel. When the feature owns a `<Feature>.i18n.ts`, the
shell carries the side-effect `import '../../<Feature>.i18n';` and the hook
reads its copy through `useTranslation(<FEATURE>_NS)`. The import sits in the
component, never in a route file: a route-level side-effect import is neither
lazy nor tree-shakeable, so the catalog would land on first paint
(`route-i18n-side-effect`). The generated files use the repo's real
conventions (tRPC `queryOptions`/`mutationOptions` shape, `I`-prefixed
interfaces, the shared `cn` helper from `@repo/ui/lib/utils`) so they pass
lint immediately and only need the `TODO` filled in.

### `pnpm new:component ui/<Name>`

Different target: writes a single kebab-case file directly into
`packages/ui/src/components/<kebab-name>.tsx` (a `forwardRef` shadcn-style
component skeleton) **and** inserts a matching `"./<kebab-name>"` export entry
into `packages/ui/package.json`'s `exports` map automatically (skips the
insert if the export key already exists). This is the only generator path
that touches a file outside `apps/web`.

## Practical workflow for adding a feature

1. `pnpm new:feature orders` (if the domain doesn't exist yet).
2. `pnpm new:component orders/OrderList`.
3. Fill in `OrderList.hooks.ts`: replace the `TODO` with the real
   `trpc.<router>.<procedure>.queryOptions()`/`mutationOptions()` call, wiring
   in any store reads.
4. Fill in `OrderList.types.ts` with the real view-model shape (`I`-prefixed).
5. Flesh out `OrderList.tsx` to render that view model, no hooks, no
   computation in JSX.
6. Wire it into a route (`src/routes/...`), routes stay a thin
   `createFileRoute` + render.
7. `pnpm --filter @repo/web lint` to confirm the architecture rules pass.
