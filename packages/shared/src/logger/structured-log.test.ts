import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger, normalizeError } from './index';

/**
 * The production sink. `structured: true` is what the API runs with
 * (apps/api/src/modules/logger/logger.service.ts), and it is the only mode
 * whose output anyone ever reads back after the fact, so it is the one that has
 * to keep an Error's message and stack.
 */
/*
 * This package compiles without the DOM or Node libs (it ships to browser,
 * Electron and Node alike), so `console` is not a global TypeScript knows
 * about. Reach it through globalThis with the one method under test typed.
 */
const runtimeConsole = (globalThis as unknown as { console: { error: (...a: unknown[]) => void } })
  .console;

function captureErrorLine(emit: (log: ReturnType<typeof createLogger>) => void): {
  raw: string;
  entry: Record<string, unknown>;
} {
  const spy = vi.spyOn(runtimeConsole, 'error').mockImplementation(() => undefined);
  emit(createLogger('Test', { structured: true }));
  const raw = String(spy.mock.calls[0]?.[0]);
  return { raw, entry: JSON.parse(raw) as Record<string, unknown> };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('normalizeError', () => {
  it("flattens an Error's non-enumerable own properties so they survive JSON", () => {
    // The bug this exists for: an Error has no enumerable own properties.
    expect(JSON.stringify(new Error('boom'))).toBe('{}');

    const out = normalizeError(new TypeError('boom')) as Record<string, unknown>;

    expect(out.name).toBe('TypeError');
    expect(out.message).toBe('boom');
    expect(String(out.stack)).toContain('boom');
    expect(JSON.stringify(out)).not.toBe('{}');
  });

  it('carries a wrapped cause one level deep', () => {
    const inner = new Error('the real failure');
    const out = normalizeError(new Error('wrapper', { cause: inner })) as Record<string, unknown>;

    expect((out.cause as Record<string, unknown>).message).toBe('the real failure');
    expect(String((out.cause as Record<string, unknown>).stack)).toContain('the real failure');
  });

  it('passes non-Errors through untouched', () => {
    expect(normalizeError('plain')).toBe('plain');
    expect(normalizeError(42)).toBe(42);
    expect(normalizeError(null)).toBeNull();
    expect(normalizeError(undefined)).toBeUndefined();
    const obj = { a: 1 };
    expect(normalizeError(obj)).toBe(obj);
  });
});

describe('structured logging of Errors', () => {
  it('emits the message and stack for an Error passed positionally, not "{}"', () => {
    const { raw, entry } = captureErrorLine((log) => {
      log.error(new Error('kaboom'));
    });

    // Regression guard: an unflattened Error emits {"...","message":"{}"}.
    expect(entry.message).toBe('kaboom');
    expect(entry.message).not.toBe('{}');
    expect(raw).toContain('kaboom');

    const err = entry.err as Record<string, unknown>;
    expect(err.name).toBe('Error');
    expect(err.message).toBe('kaboom');
    expect(String(err.stack)).toContain('kaboom');
  });

  it('keeps the stack of an Error passed as the data argument', () => {
    const { entry } = captureErrorLine((log) => {
      log.error('write failed', new Error('ENOSPC'));
    });

    expect(entry.message).toBe('write failed');
    const data = entry.data as Record<string, unknown>;
    expect(data.message).toBe('ENOSPC');
    expect(String(data.stack)).toContain('ENOSPC');
  });

  it('keeps the stack of an Error nested inside the data object', () => {
    const { entry } = captureErrorLine((log) => {
      log.error('procedure failed', { err: new Error('deep') });
    });

    const err = (entry.data as Record<string, unknown>).err as Record<string, unknown>;
    expect(err.message).toBe('deep');
    expect(String(err.stack)).toContain('deep');
  });

  it('still redacts secrets that ride alongside an Error', () => {
    const { raw } = captureErrorLine((log) => {
      log.error(new Error('auth failed'), { accessToken: 'sk_live_abc', userId: 'u-1' });
    });

    expect(raw).not.toContain('sk_live_abc');
    expect(raw).toContain('[REDACTED]');
    // userId is an identifier, not a secret: triage needs it.
    expect(raw).toContain('u-1');
  });

  it('leaves an ordinary string message alone', () => {
    const { entry } = captureErrorLine((log) => {
      log.error('plain message');
    });

    expect(entry.message).toBe('plain message');
    expect(entry.err).toBeUndefined();
  });
});
