import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import {
  auditActionKey,
  auditActionLabel,
  auditActionTone,
  auditTargetLabel,
} from './Admin.constants';
import { adminStrings } from './Admin.strings';

/**
 * The audit labels against their source of truth.
 *
 * Every label lookup falls back to the raw machine name for an action the
 * table has never heard of instead of throwing. That fallback is right at
 * runtime, and it is also why a missing label can go unnoticed. This file is
 * what makes the gap a red test.
 */
const ACTIONS = Object.values(AUDIT_ACTIONS);

describe('audit action labels', () => {
  it('names every action in the vocabulary', () => {
    const catalog: Record<string, string> = adminStrings.audit.actions;

    expect(ACTIONS.filter((action) => !catalog[auditActionKey(action)])).toEqual([]);
  });

  it('carries no label for an action that is gone', () => {
    const known = new Set(ACTIONS.map(auditActionKey));

    expect(Object.keys(adminStrings.audit.actions).filter((key) => !known.has(key))).toEqual([]);
  });

  it('never leaves a label empty or equal to its own key', () => {
    for (const [key, label] of Object.entries<string>(adminStrings.audit.actions)) {
      expect(label.trim()).not.toBe('');
      expect(label).not.toBe(key);
    }
  });

  it('renders an unknown action as its raw name rather than failing', () => {
    expect(auditActionLabel('legacy.renamed.action')).toBe('legacy.renamed.action');
    expect(auditActionLabel(AUDIT_ACTIONS.USER_ROLE_CHANGED)).toBe('Role changed');
  });

  it('labels a known target type and passes an unknown one through', () => {
    expect(auditTargetLabel('User')).toBe('User');
    expect(auditTargetLabel('Invoice')).toBe('Invoice');
  });
});

describe('auditActionTone', () => {
  it('paints any row the server recorded as a failure danger', () => {
    expect(auditActionTone(AUDIT_ACTIONS.AUTH_LOGIN_SUCCESS, false)).toBe('danger');
  });

  it('paints removals and revocations danger', () => {
    expect(auditActionTone(AUDIT_ACTIONS.USER_ACCOUNT_PURGED, true)).toBe('danger');
    expect(auditActionTone(AUDIT_ACTIONS.USER_ACCOUNT_ADMIN_DELETED, true)).toBe('danger');
    expect(auditActionTone(AUDIT_ACTIONS.USER_DISABLED, true)).toBe('danger');
    expect(auditActionTone(AUDIT_ACTIONS.USER_SESSIONS_REVOKED, true)).toBe('danger');
  });

  it('paints successes success and states everything else', () => {
    expect(auditActionTone(AUDIT_ACTIONS.AUTH_LOGIN_SUCCESS, true)).toBe('success');
    expect(auditActionTone(AUDIT_ACTIONS.USER_ENABLED, true)).toBe('success');
    expect(auditActionTone(AUDIT_ACTIONS.USER_ROLE_CHANGED, true)).toBe('neutral');
    expect(auditActionTone(AUDIT_ACTIONS.AUTH_LOGOUT, true)).toBe('neutral');
  });
});
