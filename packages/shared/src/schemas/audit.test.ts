import { describe, expect, it } from 'vitest';
import { AUDIT_LOG_LIST_DEFAULT_LIMIT, auditLogListInput, auditLogListOutput } from './audit';

describe('auditLogListInput', () => {
  it('fills the page limit from an absent input', () => {
    // prefault, not default: the fallback {} is parsed through the object so
    // the inner limit default applies (same pattern as listUsers).
    expect(auditLogListInput.parse(undefined)).toEqual({
      limit: AUDIT_LOG_LIST_DEFAULT_LIMIT,
    });
  });

  it('accepts a cursor and an explicit limit', () => {
    expect(auditLogListInput.parse({ cursor: 'a-25', limit: 10 })).toEqual({
      cursor: 'a-25',
      limit: 10,
    });
  });

  it('strips filter and search keys rather than honoring them: the list has none', () => {
    const parsed = auditLogListInput.parse({
      search: 'johnson',
      actorId: 'u-1',
      actions: ['auth.login.failure'],
    });
    expect(parsed).toEqual({ limit: AUDIT_LOG_LIST_DEFAULT_LIMIT });
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
          success: false,
          createdAt: new Date(),
        },
      ],
      nextCursor: null,
    });
    expect(result.success).toBe(true);
  });
});
