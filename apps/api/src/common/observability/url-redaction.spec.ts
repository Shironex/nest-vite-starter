import { redactUrlText } from './url-redaction';

describe('redactUrlText', () => {
  it('drops the batched tRPC input rather than enumerating parameters', () => {
    const text = redactUrlText('/trpc/users.list?batch=1&input=%7B%22search%22%3A%22Johnson%22%7D');

    expect(text).toBe('/trpc/users.list?[REDACTED]');
    expect(text).not.toContain('Johnson');
  });

  it('keeps the path of a full URL and drops its query', () => {
    expect(redactUrlText('/trpc/a,b?batch=1&input=%7B%7D')).toBe('/trpc/a,b?[REDACTED]');
    expect(redactUrlText('http://h:3000/api/auth/verify-email?token=x')).toBe(
      'http://h:3000/api/auth/verify-email?[REDACTED]',
    );
  });

  it('redacts a URL embedded in an error message', () => {
    expect(redactUrlText('Cannot GET /api/thing?input=secret-term')).toBe(
      'Cannot GET /api/thing?[REDACTED]',
    );
  });

  it('is idempotent', () => {
    for (const text of ['/trpc/a?[REDACTED]', '/health']) {
      expect(redactUrlText(text)).toBe(text);
    }
  });

  it('leaves text with no URL credential alone', () => {
    expect(redactUrlText('SELECT 1 WHERE a = ?')).toBe('SELECT 1 WHERE a = ?');
    expect(redactUrlText('HealthController.check')).toBe('HealthController.check');
  });
});
