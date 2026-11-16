import {
  SpanKind,
  context,
  trace,
  type Attributes,
  type Span,
  type SpanContext,
} from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
  type SpanExporter,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import { redactedIncomingSpanAttributes } from './otel-http-redaction';
import { RedactingSpanExporter } from './redacting-span-exporter';

const SECRET = 'feedSecret9f3c8a2b1d';
const TICKET = 'liveTicket7c2f41aa';
const INPUT = '%7B%220%22%3A%7B%22search%22%3A%22Johnson%22%7D%7D';

/**
 * Real SDK spans, a real processor, an in-memory sink behind the exporter under
 * test: the same path a span takes to the OTLP exporter in production.
 */
function pipeline(): {
  sink: InMemorySpanExporter;
  provider: TracerProvider;
  startSpan: (name: string, attributes?: Attributes) => Span;
  exported: () => Promise<ReadableSpan[]>;
} {
  const sink = new InMemorySpanExporter();
  const provider = new TracerProvider({
    spanProcessors: [new SimpleSpanProcessor({ exporter: new RedactingSpanExporter(sink) })],
  });
  const tracer = provider.getTracer('redacting-span-exporter.spec');
  return {
    sink,
    provider,
    startSpan: (name, attributes) => tracer.startSpan(name, attributes ? { attributes } : {}),
    exported: async () => {
      await provider.forceFlush();
      return sink.getFinishedSpans();
    },
  };
}

async function exportOne(name: string, attributes: Attributes): Promise<ReadableSpan> {
  const { startSpan, exported } = pipeline();
  startSpan(name, attributes).end();
  const [span] = await exported();
  if (!span) throw new Error('no span was exported');
  return span;
}

describe('RedactingSpanExporter', () => {
  it('redacts the nestjs-core handler url.full and the router http.route', async () => {
    const span = await exportOne('FeedController.feed', {
      'url.full': `/x?t=${SECRET}`,
      'http.route': `/y?t=${TICKET}`,
    });

    expect(span.attributes['url.full']).toBe('/x?[REDACTED]');
    expect(span.attributes['http.route']).toBe('/y?[REDACTED]');
  });

  it('keeps scheme, host and path of a full URL but drops its query', async () => {
    const span = await exportOne('GET', {
      'url.full': `http://api.example.test:3000/trpc/documents.list?batch=1&input=${INPUT}`,
      'http.url': `https://api.example.test/y?t=${TICKET}`,
      'http.target': `/api/auth/oauth/google/callback?code=4/0AbC&state=deadbeef`,
    });

    expect(span.attributes['url.full']).toBe(
      'http://api.example.test:3000/trpc/documents.list?[REDACTED]',
    );
    expect(span.attributes['http.url']).toBe('https://api.example.test/y?[REDACTED]');
    expect(span.attributes['http.target']).toBe('/api/auth/oauth/google/callback?[REDACTED]');
  });

  it('drops a non-empty url.query wholesale and leaves an empty one alone', async () => {
    const withQuery = await exportOne('GET', { 'url.query': `batch=1&input=${INPUT}` });
    const emptyQuery = await exportOne('GET', { 'url.query': '' });

    expect(withQuery.attributes['url.query']).toBe('[REDACTED]');
    expect(emptyQuery.attributes['url.query']).toBe('');
  });

  it('redacts an attribute under a key nobody listed, and inside string arrays', async () => {
    const span = await exportOne('custom', {
      'some.future.attribute': `GET /x?t=${SECRET} failed`,
      'http.request.header.referer': [`https://app.test/y?t=${TICKET}`, 'plain'],
      'http.response.status_code': 404,
      'error.handled': true,
      'retry.delays': [1, 2],
    });

    expect(span.attributes['some.future.attribute']).toBe('GET /x?[REDACTED] failed');
    expect(span.attributes['http.request.header.referer']).toEqual([
      'https://app.test/y?[REDACTED]',
      'plain',
    ]);
    expect(span.attributes['http.response.status_code']).toBe(404);
    expect(span.attributes['error.handled']).toBe(true);
    expect(span.attributes['retry.delays']).toEqual([1, 2]);
  });

  it('redacts the span name, the status message, events and links', async () => {
    const { startSpan, exported } = pipeline();
    const linked: SpanContext = startSpan('linked').spanContext();
    const span = startSpan(`GET /x?t=${SECRET}`);
    span.addLink({ context: linked, attributes: { 'url.full': `/x?t=${SECRET}` } });
    span.addEvent(`redirect to /y?t=${TICKET}`, { 'url.path': `/x?input=${INPUT}` });
    span.addEvent('no attributes');
    span.recordException(new Error(`Cannot GET /x?t=${SECRET}`));
    span.setStatus({ code: 2, message: `Cannot GET /trpc/a?input=${INPUT}` });
    span.end();

    const [out] = await exported();
    const text = JSON.stringify({
      name: out?.name,
      status: out?.status,
      events: out?.events,
      links: out?.links,
    });
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(TICKET);
    expect(text).not.toContain('input=');
    expect(out?.name).toBe('GET /x?[REDACTED]');
    expect(out?.status.message).toBe('Cannot GET /trpc/a?[REDACTED]');
    expect(out?.events.map((event) => event.name)).toEqual([
      'redirect to /y?[REDACTED]',
      'no attributes',
      'exception',
    ]);
    expect(out?.links[0]?.context).toEqual(linked);
  });

  it('passes a span with nothing to redact through with its identity fields intact', async () => {
    const { startSpan, exported, provider } = pipeline();
    const parent = startSpan('parent');
    const tracer = provider.getTracer('redacting-span-exporter.spec');
    const child = tracer.startSpan(
      '/health',
      { kind: SpanKind.SERVER, attributes: { 'url.path': '/health' } },
      trace.setSpan(context.active(), parent),
    );
    child.setStatus({ code: 1 });
    child.addLink({ context: parent.spanContext() });
    child.end();

    const [out] = await exported();
    expect(out?.name).toBe('/health');
    expect(out?.kind).toBe(SpanKind.SERVER);
    expect(out?.attributes).toEqual({ 'url.path': '/health' });
    expect(out?.status).toEqual({ code: 1 });
    expect(out?.spanContext()).toEqual(child.spanContext());
    expect(out?.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
    expect(out?.links).toHaveLength(1);
    expect(out?.ended).toBe(true);
  });

  it('never mutates the original span, and keeps the resource the same object', async () => {
    const seen: ReadableSpan[] = [];
    const inner: SpanExporter = {
      export: (spans, done) => {
        seen.push(...spans);
        done({ code: 0 });
      },
      shutdown: () => Promise.resolve(),
    };
    // A span as the SDK hands it to an exporter, recorded without redaction.
    const sink = new InMemorySpanExporter();
    const provider = new TracerProvider({
      spanProcessors: [new SimpleSpanProcessor({ exporter: sink })],
    });
    provider
      .getTracer('raw')
      .startSpan('x', { attributes: { 'url.full': `/x?t=${SECRET}` } })
      .end();
    await provider.forceFlush();
    const [original] = sink.getFinishedSpans();
    if (!original) throw new Error('no span was recorded');

    const done = jest.fn();
    new RedactingSpanExporter(inner).export([original], done);

    expect(original.attributes['url.full']).toBe(`/x?t=${SECRET}`);
    expect(seen[0]?.attributes['url.full']).toBe('/x?[REDACTED]');
    expect(seen[0]?.resource).toBe(original.resource);
    expect(seen[0]?.instrumentationScope).toBe(original.instrumentationScope);
    expect(done).toHaveBeenCalledWith({ code: 0 });
  });

  it('leaves what the server span hook already redacted unchanged', async () => {
    const hooked = redactedIncomingSpanAttributes({ url: `/api/feed/${SECRET}.ics?a=1` });

    const span = await exportOne('GET', hooked);

    expect(span.attributes).toEqual(hooked);
  });

  it('delegates shutdown and forceFlush, and tolerates an inner exporter with no forceFlush', async () => {
    const shutdown = jest.fn().mockResolvedValue(undefined);
    const forceFlush = jest.fn().mockResolvedValue(undefined);
    const withFlush = new RedactingSpanExporter({ export: jest.fn(), shutdown, forceFlush });
    const withoutFlush = new RedactingSpanExporter({ export: jest.fn(), shutdown });

    await withFlush.forceFlush();
    await withFlush.shutdown();
    await expect(withoutFlush.forceFlush()).resolves.toBeUndefined();

    expect(forceFlush).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });
});
