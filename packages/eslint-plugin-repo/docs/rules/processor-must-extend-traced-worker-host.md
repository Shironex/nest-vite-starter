# `repo/processor-must-extend-traced-worker-host`

A class decorated with `@Processor(...)` must `extends TracedWorkerHost`.

`TracedWorkerHost` (the repo's `WorkerHost` subclass) re-enters the producer's
ALS `RequestContext` and starts a `bullmq.process` OTel span before running
`processJob`. A processor on the bare `@nestjs/bullmq` `WorkerHost` silently
loses request/trace correlation and centralized failure logging. This is the
DI-shaped replacement for the upstream `eslint-plugin-bullmq`
`worker-must-listen-failed` rule, which only matches standalone `new Worker(...)`.

Report-only (changing a base class is a semantic edit, not safely auto-fixable).

## Incorrect

```ts
@Processor(QUEUE_NAMES.EMAIL_DELIVERY)
export class EmailDeliveryProcessor extends WorkerHost {}
```

## Correct

```ts
@Processor(QUEUE_NAMES.EMAIL_DELIVERY)
export class EmailDeliveryProcessor extends TracedWorkerHost {}
```
