---
subsystem: Audit trail
globs:
  - apps/api/src/modules/audit/*.ts
  - apps/api/src/modules/**/*.service.ts
  - packages/shared/src/audit/*.ts
---

# Audit trail

`AuditLog` is the append-only record of who changed what. It is read by the audit browser, by the
security specs and by every incident review, which means an action that never wrote a row is
invisible forever.

The honest headline for this subsystem: **less is enforced here than the rule name suggests**.

## Entry points

- `modules/audit/audit.service.ts` - `log()`, the only writer.
- `packages/shared/src/audit/index.ts` - `AUDIT_ACTIONS`, the shared vocabulary.
- `modules/audit/audit-retention.service.ts` - the sweep that ages rows out.
- Every mutating service in `apps/api/src/modules`.

## Risks

- Two rules sound alike and check different things. `no-audit-write-in-transaction` polices WHERE
  an audit write sits and nothing more; `mutation-entry-must-reach-audit` polices whether one is
  reachable at all. Neither checks that the row describes the write it accompanies.
- Coverage is anchored at `@Mutation()`. A write reached by a cron, a queue processor or an
  internal caller with no entry point is outside what the lint can see, and stays a review item.
- An action name is a string. A typo produces a row nobody will ever filter for, which is why the
  vocabulary is a const union in `@repo/shared` rather than literals at the call sites.
- A refusal is worth more than a success and is the easier one to forget: the interesting audit row
  for a removed member is the one written when they are turned away.
- The retention sweep deletes rows. It reaches across tenants by design, so it is one of the few
  places allowed outside the scope.

## Invariants

### An audit write never runs inside a transaction

**Enforced by:** `eslint:noctcore-prisma/no-audit-write-in-transaction`

The row must survive the rollback of the thing it describes, which is why it is written after the
transaction commits rather than inside it.

### Every audit action comes from the shared vocabulary

**Enforced by:** `file:packages/shared/src/audit/index.ts`

`AUDIT_ACTIONS` is a const object with a derived union, so a call site passing a literal that is
not in it is a compile error rather than a bad row.

### Audit rows are tenant-scoped on read

**Enforced by:** `file:apps/api/src/modules/audit/audit-read.isolation.spec.ts`

### Every mutation entry point reaches an audit write

**Enforced by:** `eslint:noctcore-prisma/mutation-entry-must-reach-audit`

Stated at the entry point, not at the service, because that is the boundary where the claim is
both true and checkable. From each `@Mutation()` the rule follows the calls the type checker
resolved, across files, and reports an entry that can reach a Prisma write but no audit write.

What it proves is narrower than the heading suggests, and the gap is the point:

- it proves an audit is REACHABLE from the entry, not that it runs on every path, and not that it
  records the write you are looking at;
- an entry whose call graph it cannot fully read (an interface, an abstract method, a value typed
  `any`) is SKIPPED rather than reported, so silence there means unknown, not safe;
- a mutation no entry point reaches is invisible to it: if nothing with `@Mutation()` calls a
  service method, nothing here would notice if its audit disappeared.

The per-service reading was measured and rejected: it flagged 24 of 83 public mutating methods on
this tree, of which 3 or 4 were real, the rest being helpers whose callers all audit, retention
sweeps, and deliberate exemptions. A check that cries wolf 20 times gets exemptions bolted on
until it means nothing.

Deliberate exemptions carry their reason next to them in `packages/eslint-config/nestjs.js`:
tour progress, and notification read state, which `Notification.readAt` already records.

### A refused authentication attempt audits its reason

**Enforced by:** `unenforced`, follow-up in `docs/invariants/README.md#unenforced-invariants`

`refuseIneligible` in `two-factor-challenge.service.ts` does it for the mint gate. Nothing requires
a new refusal path to do the same.

## Review checklist

- [ ] Does every new mutation write an audit row, and is the row written outside the transaction?
- [ ] Is the action name in `AUDIT_ACTIONS`, or is it a new one that belongs there?
- [ ] Does the refusal path audit as well as the success path?
- [ ] Does the row carry a tenant id where the entity has one, so the audit browser can find it?
