import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS } from './index';

/**
 * An audit action's VALUE is persisted in `AuditLog.action`, append-only, and
 * the audit screen filters and labels rows by it. A constant may be renamed,
 * but the string it names may not: a new value would orphan every row already
 * written under the old one.
 */
describe('persisted audit action values', () => {
  it('keeps the Workspace actions on their persisted strings', () => {
    expect(AUDIT_ACTIONS.WORKSPACE_CREATED).toBe('workspace.created');
    expect(AUDIT_ACTIONS.WORKSPACE_UPDATED).toBe('workspace.updated');
  });
});
