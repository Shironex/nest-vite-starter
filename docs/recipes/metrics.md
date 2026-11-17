# Recipe: a metrics endpoint

**When you need it:** a Prometheus-style scraper reads `/metrics` from your containers. The starter
has no endpoint and no metric names on purpose: a template's names would only drift from yours,
and a central stack can scrape container metrics without app support.

## Shape of the change

- **Library.** Add `prom-client` and a `MetricsModule` with a registry and
  `collectDefaultMetrics` for process metrics.
- **Endpoint.** A plain `@Controller('metrics')` (plain HTTP is for what tRPC cannot serve). It must
  not be reachable from the internet: bind it to a second internal port, or protect it with a
  bearer token from a new env key, and do not route it through the public reverse proxy.
- **What to measure.** Start with a request duration histogram from an interceptor (label by
  route and status class), and the queue depths. `QueueMetricsService`
  (`common/queue/queue-metrics.service.ts`) already polls job counts for every queue every 15
  seconds, so export those as gauges instead of querying Redis again.
- **Business counters.** Increment next to the audit write (sign-ins, lockouts) so the two stay in
  step.

## Pitfalls

- Label cardinality: never label by user id, email, session id or raw URL. Use the route
  template.
- Do not put secrets or PII in labels or help text.
- Behind `TRUST_PROXY`, make sure the scraper does not share the limit of a public client.
- Keep the names stable once dashboards depend on them, and document them next to the code.
