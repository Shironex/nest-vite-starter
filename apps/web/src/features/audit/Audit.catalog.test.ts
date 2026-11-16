import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { auditActionKey } from './Audit.constants';
import { auditStrings } from './Audit.strings';

/**
 * The audit strings against their source of truth.
 *
 * WHY THIS FILE EXISTS. Every label lookup on this screen falls back to the raw
 * machine name (`auth.2fa.enforced`) for an action the table has never heard of
 * instead of throwing. That fallback is correct at runtime (a row written by a
 * newer server must still render, and the audit log is the last screen that
 * should fail closed), but it is also why a missing label can go unnoticed for a
 * long time. The fallback keeps the screen working; this test is what makes the
 * gap visible.
 *
 * So: adding an action to `AUDIT_ACTIONS` without adding its label is a red
 * test, not a silent machine name in front of an auditor.
 */

const ACTIONS = Object.values(AUDIT_ACTIONS);

const actionKey = auditActionKey;

/** Domains the filter dropdown derives, in the order the vocabulary declares. */
const DOMAINS = [...new Set(ACTIONS.map((action) => action.split('.')[0]!))];

describe('audit action labels', () => {
  it('names every action in the vocabulary', () => {
    const catalog: Record<string, string> = auditStrings.actions;

    const missing = ACTIONS.filter((action) => !catalog[actionKey(action)]);

    expect(missing).toEqual([]);
  });

  it('carries no label for an action that is gone', () => {
    const catalog: Record<string, string> = auditStrings.actions;
    const known = new Set(ACTIONS.map(actionKey));

    expect(Object.keys(catalog).filter((key) => !known.has(key))).toEqual([]);
  });

  it('never leaves a label empty or equal to its own key', () => {
    for (const [key, label] of Object.entries<string>(auditStrings.actions)) {
      expect(label.trim()).not.toBe('');
      expect(label).not.toBe(key);
    }
  });
});

describe('audit action groups', () => {
  it('names every domain the dropdown groups by', () => {
    const groups: Record<string, string> = auditStrings.actionGroups;

    expect(DOMAINS.filter((domain) => !groups[domain])).toEqual([]);
  });

  it('carries no group for a domain that is gone', () => {
    const groups: Record<string, string> = auditStrings.actionGroups;

    expect(Object.keys(groups).filter((key) => !DOMAINS.includes(key))).toEqual([]);
  });
});

describe('audit target types', () => {
  /**
   * The source of truth here is the api's `targetType:` call sites, which are
   * plain strings rather than a shared const, so this cannot be derived the way
   * the action list is. What it CAN pin is that no label renders blank, which
   * is the half that drifts silently. (A label equal to its key is fine here:
   * `User` is both the model name and its English label.)
   */
  it('never leaves a target-type label empty', () => {
    for (const label of Object.values<string>(auditStrings.targetTypes)) {
      expect(label.trim()).not.toBe('');
    }
  });
});
