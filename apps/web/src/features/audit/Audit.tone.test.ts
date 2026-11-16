import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { auditActionTone } from './Audit.constants';

/**
 * The status pill an audited row wears.
 *
 * This screen is read by people deciding whether the documentation was handled
 * lawfully, so a color is an assertion, not decoration. The cases below are
 * the ones where the marker lists would otherwise say something untrue.
 */

describe('auditActionTone: irreversible destruction is danger', () => {
  it('puts it with the destructions it belongs beside', () => {
    expect(auditActionTone(AUDIT_ACTIONS.USER_ACCOUNT_PURGED, true)).toBe('danger');
    expect(auditActionTone(AUDIT_ACTIONS.USER_ACCOUNT_ADMIN_DELETED, true)).toBe('danger');
  });
});

describe('auditActionTone: the rows that were already right', () => {
  it('still paints any row the server recorded as a failure danger', () => {
    // A refusal is written with success: false, so it reaches danger through
    // the first branch rather than through a marker.
    expect(auditActionTone(AUDIT_ACTIONS.AUTH_LOGIN_SUCCESS, false)).toBe('danger');
  });

  it('leaves every other pre-existing action on the tone it already had', () => {
    expect(auditActionTone(AUDIT_ACTIONS.AUTH_LOGIN_SUCCESS, true)).toBe('success');
    expect(auditActionTone(AUDIT_ACTIONS.WORKSPACE_CREATED, true)).toBe('success');
    expect(auditActionTone(AUDIT_ACTIONS.USER_ACCOUNT_DELETED, true)).toBe('danger');
    expect(auditActionTone(AUDIT_ACTIONS.USER_ROLE_CHANGED, true)).toBe('neutral');
    expect(auditActionTone(AUDIT_ACTIONS.AUTH_LOGOUT, true)).toBe('neutral');
  });
});
