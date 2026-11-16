import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS } from '../audit/index';
import {
  AUDIT_LOG_LIST_DEFAULT_LIMIT,
  AUDIT_LOG_MAX_ACTIONS,
  auditActionSchema,
  auditLogListInput,
  auditLogListOutput,
} from './audit';

describe('auditActionSchema', () => {
  it('accepts every canonical action, so no recorded event type is unfilterable', () => {
    for (const action of Object.values(AUDIT_ACTIONS)) {
      expect(auditActionSchema.safeParse(action).success).toBe(true);
    }
  });

  it('refuses an action outside the vocabulary', () => {
    expect(auditActionSchema.safeParse('auth.login.invented').success).toBe(false);
  });
});

describe('auditLogListInput', () => {
  it('fills the page limit from an absent input', () => {
    // prefault, not default: the fallback {} is parsed through the object so
    // the inner limit default applies (same pattern as listUsers).
    expect(auditLogListInput.parse(undefined)).toEqual({
      limit: AUDIT_LOG_LIST_DEFAULT_LIMIT,
    });
  });

  it('accepts the full structured filter set', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    const to = new Date('2026-01-31T00:00:00Z');
    const parsed = auditLogListInput.parse({
      actorId: 'u-1',
      actions: [AUDIT_ACTIONS.USER_ROLE_CHANGED, AUDIT_ACTIONS.USER_DISABLED],
      from,
      to,
    });
    expect(parsed.actorId).toBe('u-1');
    expect(parsed.actions).toEqual(['user.role.changed', 'user.account.disabled']);
    expect(parsed.from).toBe(from);
    expect(parsed.to).toBe(to);
  });

  it('refuses a range whose end precedes its start', () => {
    const result = auditLogListInput.safeParse({
      from: new Date('2026-02-01T00:00:00Z'),
      to: new Date('2026-01-01T00:00:00Z'),
    });
    expect(result.success).toBe(false);
  });

  it('refuses a range longer than the scan bound', () => {
    const result = auditLogListInput.safeParse({
      from: new Date('2025-01-01T00:00:00Z'),
      to: new Date('2026-06-01T00:00:00Z'),
    });
    expect(result.success).toBe(false);
  });

  it('refuses an empty or oversized actions array', () => {
    expect(auditLogListInput.safeParse({ actions: [] }).success).toBe(false);
    const oversized = Array.from(
      { length: AUDIT_LOG_MAX_ACTIONS + 1 },
      () => AUDIT_ACTIONS.AUTH_LOGIN_FAILURE,
    );
    expect(auditLogListInput.safeParse({ actions: oversized }).success).toBe(false);
  });

  it('has no free-text search field, by design', () => {
    // Unknown keys are stripped, never honored: a "search" filter must not
    // silently pretend to narrow the feed.
    const parsed = auditLogListInput.parse({ search: 'johnson' });
    expect(parsed).not.toHaveProperty('search');
  });
});

describe('auditLogListOutput', () => {
  it('carries action as a plain string so unknown historical actions still render', () => {
    const result = auditLogListOutput.safeParse({
      items: [
        {
          id: 'a-1',
          action: 'legacy.renamed.action',
          actor: null,
          targetType: null,
          targetId: null,
          before: null,
          after: null,
          metadata: { anything: true },
          reason: null,
          ipAddress: null,
          userAgent: null,
          correlationId: null,
          success: false,
          createdAt: new Date(),
        },
      ],
      nextCursor: null,
    });
    expect(result.success).toBe(true);
  });
});
