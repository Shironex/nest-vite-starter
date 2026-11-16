# The security lane

One file per security finding, one named case per claim, and a manifest that
fails the build when a claim changes in either direction.

A fix that lands with ordinary tests says nothing about "finding X stays fixed":
a case can be renamed, skipped, quietly turned green, or never run at all, and
every one of those looks exactly like success. This lane makes each finding a
named, reconciled claim. Findings are numbered `SEC-001`, `SEC-002` and so on;
`issue` is optional in `findings.json` for a finding tracked in an issue tracker.

## Running it

```bash
export DATABASE_URL="$(grep -E '^DATABASE_URL=' ../../../.env | cut -d= -f2-)"
pnpm check:security        # from the repo root: runs the suite, then reconciles
```

`pnpm check:security`, not jest's exit code, is the gate. A finding recorded as
`proven` carries an expected-red case, so a red jest run can be exactly right;
and a green jest run proves nothing if a case never ran. To reconcile a report
produced elsewhere (CI runs the suite as a step in `test-api`):

```bash
pnpm check:security -- --junit apps/api/security-spec/.junit/security.xml
```

## Adding a finding

```bash
pnpm new:finding SEC-007 session-epoch-fence   # an issue number may follow
```

That writes the spec and its manifest row together, both RED as infrastructure,
and the gate stays red until you write the test. Then, in order:

1. Write the finding case and watch it **fail against the unfixed code**. A test
   that has never failed is not coverage.
2. Write the `control:` case: the one case in the suite that asserts the
   machinery works, so the absence assertions around it mean something.
3. Copy the case names into `findings.json` exactly as jest reports them
   (`<describe chain> > <title>`).
4. When the fix lands: status `proven` -> `fixed`, the case `fail` -> `pass`,
   and describe the fix in the file header.

## The rules of the folder

- `harness.ts` throws where the ordinary helpers return a boolean:
  `requirePostgresOrFail` / `requireRedisOrFail` refuse to let a case bail, and
  `specPrecondition()` marks a failure `SPEC-INFRA`, which the reconciler
  records as `blocked` rather than as evidence for or against the finding.
- `barrier(n)` and `raceAll(n, task)` (from `test/concurrency.ts`) force an
  overlap instead of hoping for one. A lock that is only ever taken by one
  transaction at a time has not been shown to serialize anything.
- Every `describe` owns a `control:` case
  (`security-spec-requires-control`), and no case may skip, focus, return early
  or assert nothing (`security-spec-no-silent-bail`). Both are lint-meta rules,
  AST-based, scoped to this folder, and they run on every `pnpm lint:meta`.
- An assertion factored into a helper must be NAMED `expect...`, which is how
  the lint rule sees it.

## What lives here and what does not

A finding whose wider surface already has an isolation spec is **referenced**,
not copied: the file header names the isolation spec, and the case here is the
narrow invariant that must never go quiet. The isolation lane keeps running in
`test:integration` as before; this lane adds the reconciled claim, not a second
copy of the proof.
