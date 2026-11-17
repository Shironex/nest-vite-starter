import { LOG_DENY_NAMES } from '@repo/eslint-config/nestjs';
import { describe, expect, it } from 'vitest';
import { SENSITIVE_KEY_PATTERNS } from './index';

// `LOG_DENY_NAMES` feeds `observability/no-sensitive-fields-in-logs`. It is a
// hand-kept mirror of the runtime list because @repo/eslint-config cannot import
// @repo/shared (workspace cycle). This test is the one place both are visible.
describe('log redaction denylist parity', () => {
  it('has no runtime pattern missing from the lint rule', () => {
    const missing = SENSITIVE_KEY_PATTERNS.filter((p) => !LOG_DENY_NAMES.includes(p));
    expect(missing).toEqual([]);
  });

  it('has no lint-only name the runtime redactor does not know', () => {
    const extra = LOG_DENY_NAMES.filter(
      (n) => !(SENSITIVE_KEY_PATTERNS as readonly string[]).includes(n),
    );
    expect(extra).toEqual([]);
  });
});
