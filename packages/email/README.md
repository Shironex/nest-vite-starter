# @repo/email

React-email (JSX) templates rendered to HTML. Consumed by the API's
`EmailRendererService` through the `esmImport` workaround (this package is
ESM-only; apps/api compiles to CJS).

## Templates

`verification`, `password-reset`, `welcome`, `password-changed`: each exports a
typed `*Props` and a `render*Email(props): Promise<string>`.

## Workflow

```bash
pnpm --filter @repo/email preview   # live react-email dev server
pnpm --filter @repo/email build     # tsup build (run in CI/turbo)
pnpm --filter @repo/email test      # render smoke test (each template -> non-empty HTML)
```

`build` + `check-types` run in the turbo pipeline, so a broken JSX template
fails before deploy; the render smoke test additionally catches render-time
throws a type-check would miss. This is the react-email equivalent of a
template-precompile gate (no Handlebars).

## The `preview` script will ask to install `@react-email/ui`

Say yes locally. Do not commit the result.

`preview` is the only script here that needs `@react-email/ui`, and the package is
deliberately **not** a dependency of this workspace. It is the sole importer of
`next`, which carried 9 Dependabot advisories (4 high, 5 moderate) plus a
transitive `sharp@0.34.5` (high). Removing it cleared all 10. Nothing else
degraded: `build`, `check-types`, `test`, and the templates the API actually
renders never touched it.

react-email's CLI notices the package is missing and offers to install it. That
is fine, and it is why the preview workflow still works. But the CLI installs it
by writing `@react-email/ui` back into this package's `devDependencies`, so an
accepted prompt leaves a manifest change you did not author. Committing it
reintroduces all 10 advisories.

The `banned-dependencies` lint:meta rule fails the build if it reaches a commit
(`pnpm lint:meta`, which runs in CI). If you hit it, drop the manifest change and
keep the install:

```bash
git checkout packages/email/package.json
```

If the preview server becomes part of the regular workflow, reopen the decision
deliberately rather than letting the dependency drift back in. The rejected
alternative was pinning `next` forward, which cannot clear the `sharp` advisory.
