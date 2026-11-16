# `repo/job-name-must-be-constant`

Queue and job names must be constants, not inline string literals.

The first argument to `@Processor('...')` and to `<queue>.add('...', ...)` must
reference a constant from `QUEUE_NAMES` / `*_JOB_NAMES`. Inline literals let a
typo silently create a second queue or a job no processor handles; a shared
constant keeps producer and consumer in agreement. Identifiers and member
accesses (the constants) pass; string literals and no-substitution template
literals are flagged. Report-only (no literal-to-constant map to fix from).

## Incorrect

```ts
@Processor('email-delivery')
export class EmailDeliveryProcessor extends TracedWorkerHost {}

await this.queue.add('send-welcome', withJobContext({ to }));
```

## Correct

```ts
@Processor(QUEUE_NAMES.EMAIL_DELIVERY)
export class EmailDeliveryProcessor extends TracedWorkerHost {}

await this.queue.add(EMAIL_DELIVERY_JOB_NAMES.SEND_WELCOME, withJobContext({ to }));
```
