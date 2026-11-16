import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { auditActionLabelKey, auditTargetLabelKey } from './Audit.constants';
import en from './locales/en.json';

/**
 * The audit catalog against its source of truth.
 *
 * WHY THIS FILE EXISTS. Every label lookup on this screen passes
 * `defaultValue`, so an action the catalog has never heard of renders as its
 * raw machine name (`auth.2fa.enforced`) instead of throwing. That
 * fallback is correct at runtime (a row written by a newer server must still
 * render, and the audit log is the last screen that should fail closed), but it
 * is also why a missing label can go unnoticed for a long time. The fallback keeps the screen working; this test is what makes the
 * gap visible.
 *
 * So: adding an action to `AUDIT_ACTIONS` without adding its label here is a red
 * test, not a silent machine name in front of an auditor.
 */

const LABEL_PREFIX = 'actions.';

const ACTIONS = Object.values(AUDIT_ACTIONS);

/** The flattened catalog key for an action, minus the namespace prefix. */
function actionKey(action: string): string {
  return auditActionLabelKey(action).slice(LABEL_PREFIX.length);
}

/** Domains the filter dropdown derives, in the order the vocabulary declares. */
const DOMAINS = [...new Set(ACTIONS.map((action) => action.split('.')[0]!))];

describe('audit action labels', () => {
  it('names every action in the vocabulary', () => {
    const catalog: Record<string, string> = en.actions;

    const missing = ACTIONS.filter((action) => !catalog[actionKey(action)]);

    expect(missing).toEqual([]);
  });

  it('carries no label for an action that is gone', () => {
    const catalog: Record<string, string> = en.actions;
    const known = new Set(ACTIONS.map(actionKey));

    expect(Object.keys(catalog).filter((key) => !known.has(key))).toEqual([]);
  });

  it('never leaves a label empty or equal to its own key', () => {
    for (const [key, label] of Object.entries<string>(en.actions)) {
      expect(label.trim()).not.toBe('');
      expect(label).not.toBe(key);
    }
  });
});

describe('audit action groups', () => {
  it('names every domain the dropdown groups by', () => {
    const groups: Record<string, string> = en.actionGroups;

    expect(DOMAINS.filter((domain) => !groups[domain])).toEqual([]);
  });

  it('carries no group for a domain that is gone', () => {
    const groups: Record<string, string> = en.actionGroups;

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
    for (const label of Object.values<string>(en.targetTypes)) {
      expect(label.trim()).not.toBe('');
    }
  });

  it('resolves a label for every target type the notification work introduced', () => {
    const introduced = ['NotificationPreference'];
    const catalog: Record<string, string> = en.targetTypes;

    for (const targetType of introduced) {
      expect(auditTargetLabelKey(targetType)).toBe(`targetTypes.${targetType}`);
      expect(catalog[targetType]).toBeTruthy();
    }
  });
});
