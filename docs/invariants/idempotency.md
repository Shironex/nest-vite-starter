---
subsystem: Idempotency
globs:
  - apps/api/src/common/idempotency/*.ts
  - apps/api/src/modules/**/*.router.ts
  - apps/web/src/features/**/*.hooks.ts
  - apps/web/src/features/**/*.mutations.ts
---

# Idempotency

`IdempotencyMiddleware` replays a cached response when the caller sends the same `Idempotency-Key`
twice. It is a two-sided contract, and the interesting property is that **neither side fails when
the other is missing**: the server passes an unkeyed request straight through, the client gets a
normal response, and both sides' tests pass.

That is how it drifts into decoration: a guarded procedure whose only web caller never sends a key
advertises double-submit protection it does not have, and every test stays green.

## Entry points

- `common/idempotency/idempotency.middleware.ts` - the server half and the Redis cache.
- Every `@UseMiddlewares(..., IdempotencyMiddleware)` mutation in an `apps/api` router.
- Every web mutation hook that threads `trpc: { context: { idempotencyKey } }` through
  `mutationOptions`.

## Risks

- A decorator added without a caller looks like protection and is inert.
- A guard on a procedure whose response must NOT be replayed is worse than none:
  `storage.requestUpload` returns a 300 s capability, and caching it for 24 h hands out a replayable
  credential. The honest fix there was to drop the middleware, not to allowlist it.
- The reverse direction is harmless: a key sent to an unguarded procedure is ignored.

## Invariants

### Every guarded mutation has a web caller that sends a key

**Enforced by:** `lint-meta:idempotency-key-parity`

The rule derives `<alias>.<method>` from the `@Router({ alias })` and requires some file under
`apps/web/src` to name it and mention `idempotencyKey`. A procedure with no web caller at all
passes: the guard is allowed to be correct in advance of the screen.

### The exemption list stays empty

**Enforced by:** `lint-meta:idempotency-key-parity`

An entry asserts that a guard is worth keeping while permanently inert, which is a claim that needs
a reason written next to it. It is empty today and should stay that way.

### A replayable response is never cached

**Enforced by:** `unenforced`, follow-up in `docs/invariants/README.md#unenforced-invariants`

Nothing distinguishes a safe-to-replay response from a capability. `storage.requestUpload` was
found by reading, not by a rule.

## Review checklist

- [ ] Does a new guarded mutation have a web caller that actually sends a key?
- [ ] Is the response safe to hand back unchanged for 24 hours, or is it a short-lived credential?
- [ ] If the middleware was removed from a procedure, is the reason written next to it?
