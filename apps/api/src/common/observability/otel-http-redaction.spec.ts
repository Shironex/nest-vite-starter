import { redactUrlText, redactedIncomingSpanAttributes } from './otel-http-redaction';

/**
 * The instrumentation hands the hook a real IncomingMessage; only `url` (the
 * raw request target) is read, so a bare object is enough here.
 */
const request = (url: string) => ({ url });

describe('redactedIncomingSpanAttributes', () => {
  it('sets only the stable target attributes a server span carries', () => {
    // instrumentation-http emits url.path and url.query on server spans and
    // nothing else that holds the target; any other key would be invented.
    const attributes = redactedIncomingSpanAttributes(request('/api/feed/x.ics?a=1'));

    expect(Object.keys(attributes).sort()).toEqual(['url.path', 'url.query']);
  });

  it('drops the batched tRPC input rather than enumerating parameters', () => {
    const attributes = redactedIncomingSpanAttributes(
      request('/trpc/users.list?batch=1&input=%7B%22search%22%3A%22Johnson%22%7D'),
    );

    expect(JSON.stringify(attributes)).not.toContain('input=');
    expect(JSON.stringify(attributes)).not.toContain('Johnson');
    expect(attributes['url.path']).toBe('/trpc/users.list');
    expect(attributes['url.query']).toBe('[REDACTED]');
  });

  it('drops the OAuth callback authorization code and state', () => {
    const attributes = redactedIncomingSpanAttributes(
      request('/api/auth/oauth/google/callback?code=4/0AbCdEf&state=deadbeef'),
    );

    const serialised = JSON.stringify(attributes);
    expect(serialised).not.toContain('4/0AbCdEf');
    expect(serialised).not.toContain('deadbeef');
    expect(attributes['url.path']).toBe('/api/auth/oauth/google/callback');
  });

  it('leaves an ordinary path legible so traces stay useful', () => {
    const attributes = redactedIncomingSpanAttributes(request('/health'));

    expect(attributes['url.path']).toBe('/health');
    // No query on the request, so no invented attribute.
    expect(attributes['url.query']).toBeUndefined();
  });

  it('tolerates a request with no target at all', () => {
    expect(redactedIncomingSpanAttributes({ url: undefined })['url.path']).toBe('');
  });
});

describe('redactUrlText', () => {
  it('keeps the path of any other URL and drops its query', () => {
    expect(redactUrlText('/trpc/a,b?batch=1&input=%7B%7D')).toBe('/trpc/a,b?[REDACTED]');
    expect(redactUrlText('http://h:3000/api/auth/oauth/google/callback?code=x&state=y')).toBe(
      'http://h:3000/api/auth/oauth/google/callback?[REDACTED]',
    );
  });

  it('is idempotent, so the exporter can run over what the hook already redacted', () => {
    for (const text of ['/api/feed/[REDACTED]', '/trpc/a?[REDACTED]', '/health']) {
      expect(redactUrlText(text)).toBe(text);
    }
  });

  it('leaves text with no URL credential alone', () => {
    expect(redactUrlText('SELECT 1 WHERE a = ?')).toBe('SELECT 1 WHERE a = ?');
    expect(redactUrlText('FeedController.feed')).toBe('FeedController.feed');
  });
});
