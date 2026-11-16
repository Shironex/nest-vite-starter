/**
 * Job-data contract for the two-factor-enforcement queue.
 *
 * The sweep carries NO payload: it reads every input it needs fresh from the
 * database on each run (the set of expired/expiring `TwoFactorPolicy` rows and
 * their non-enrolled members), so there is nothing tenant- or member-specific
 * to serialize into Redis. The producer still wraps the empty object in
 * `withJobContext(...)` so the worker re-enters an ALS/trace context; the
 * reserved `_ctx` / `_traceparent` siblings are stripped back off by the schema
 * before the worker reads it.
 */
export type TwoFactorEnforcementJobData = Record<string, never>;
