import type { AttributeValue, Attributes, Link } from '@opentelemetry/api';
import type { ReadableSpan, SpanExporter, TimedEvent } from '@opentelemetry/sdk-trace';
import { REDACTED, redactUrlText } from './otel-http-redaction';

/**
 * Wraps the trace exporter so every span is redacted on its way out, whichever
 * instrumentation produced it.
 *
 * The incoming server span hook (`redactedIncomingSpanAttributes`) only ever
 * reached the http server span. The other auto-instrumentations record the raw
 * request URL on spans of their own, and the hook never sees those:
 *
 * - `@opentelemetry/instrumentation-nestjs-core` sets `url.full` to
 *   `req.originalUrl` on the controller handler span (`HrIcsController.feed`);
 * - `@opentelemetry/instrumentation-router` sets `http.route` to
 *   `req.baseUrl`, which for a Nest middleware layer is the concrete path, and
 *   renames the parent span after it.
 *
 * Redacting here, at the one place every span passes before any byte leaves
 * the process, covers those and every instrumentation added later. It runs on
 * every attribute (span, event and link), the span name, the status message
 * and event names, not on a list of keys, because the leak was precisely an
 * attribute nobody had listed.
 *
 * Why an exporter wrapper and not a SpanProcessor: once a span has ended the
 * SDK ignores `setAttribute`, and the only processor hook that runs before
 * that, `onEnding`, is marked experimental in sdk-trace 2.x. `SpanExporter` is
 * the stable seam, and wrapping it leaves NodeSDK building its own
 * BatchSpanProcessor (and its env-driven settings) around this exporter. The
 * original span is never mutated: the exporter receives a redacted copy.
 */
export class RedactingSpanExporter implements SpanExporter {
  constructor(private readonly inner: SpanExporter) {}

  export(spans: ReadableSpan[], resultCallback: Parameters<SpanExporter['export']>[1]): void {
    this.inner.export(spans.map(redactSpan), resultCallback);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush ? this.inner.forceFlush() : Promise.resolve();
  }
}

function redactValue(key: string, value: AttributeValue | undefined): AttributeValue | undefined {
  // `url.query` holds a bare query string with no `?` in front, so the URL
  // rule would not recognize it; it is dropped wholesale, as on the server span.
  if (key === 'url.query') return value === undefined || value === '' ? value : REDACTED;
  if (typeof value === 'string') return redactUrlText(value);
  if (isStringArray(value)) return value.map((item) => (item == null ? item : redactUrlText(item)));
  return value;
}

/** OTel attribute arrays are homogeneous; only a string array can carry a URL. */
function isStringArray(value: AttributeValue | undefined): value is (string | null | undefined)[] {
  return Array.isArray(value) && value.every((item) => item == null || typeof item === 'string');
}

function redactAttributes(attributes: Attributes): Attributes {
  const redacted: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    redacted[key] = redactValue(key, value);
  }
  return redacted;
}

function redactEvent(event: TimedEvent): TimedEvent {
  const redacted: TimedEvent = { ...event, name: redactUrlText(event.name) };
  if (event.attributes) redacted.attributes = redactAttributes(event.attributes);
  return redacted;
}

function redactLink(link: Link): Link {
  return link.attributes ? { ...link, attributes: redactAttributes(link.attributes) } : link;
}

/**
 * A copy of the span with every URL-shaped string redacted. Every other field
 * is carried by reference; the resource in particular must stay the same
 * object, because the OTLP serializer groups spans by resource identity.
 */
function redactSpan(span: ReadableSpan): ReadableSpan {
  return {
    name: redactUrlText(span.name),
    kind: span.kind,
    spanContext: () => span.spanContext(),
    ...(span.parentSpanContext ? { parentSpanContext: span.parentSpanContext } : {}),
    startTime: span.startTime,
    endTime: span.endTime,
    status:
      span.status.message === undefined
        ? span.status
        : { ...span.status, message: redactUrlText(span.status.message) },
    attributes: redactAttributes(span.attributes),
    links: span.links.map(redactLink),
    events: span.events.map(redactEvent),
    duration: span.duration,
    ended: span.ended,
    resource: span.resource,
    instrumentationScope: span.instrumentationScope,
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.droppedLinksCount,
  };
}
