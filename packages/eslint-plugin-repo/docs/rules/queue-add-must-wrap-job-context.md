# `repo/queue-add-must-wrap-job-context`

A `.add(name, data)` call on a BullMQ queue must wrap its data in
`withJobContext(...)`.

`withJobContext` stamps the request id, user id, and W3C traceparent onto the
job payload so the worker (via `TracedWorkerHost`) re-enters the producer's
context and the trace stays a continuous parent -> child chain. An unwrapped
producer breaks that correlation.

Heuristic match (no type info): fires on a `.add(...)` whose receiver name
matches `/queue/i` (e.g. `this.queue`, `emailQueue`) when the second argument is
not a `withJobContext(...)` call. Report-only: wrapping changes the runtime
payload shape, so an autofix would not be safe.

## Options

```jsonc
{ "wrapperName": "withJobContext" }
```

## Incorrect

```ts
await this.queue.add(JOB_NAMES.SEND_WELCOME, { to });
```

## Correct

```ts
await this.queue.add(JOB_NAMES.SEND_WELCOME, withJobContext({ to }));
```
