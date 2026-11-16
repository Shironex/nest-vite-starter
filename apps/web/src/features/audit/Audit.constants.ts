import { AUDIT_ACTIONS, type AuditAction } from '@repo/shared/audit';
import type { StatusTone } from '@repo/ui/status-pill';
import { labelFor } from '@/lib/strings';
import { auditStrings } from './Audit.strings';
import type { AuditQuickFilter } from './Audit.types';

/**
 * The action sets behind the one-click chips. Each ORs every flavor of its
 * question so "show me the failed sign-ins" is one click, not five dropdown
 * round-trips.
 */
export const AUDIT_QUICK_FILTER_ACTIONS: Record<AuditQuickFilter, readonly AuditAction[]> = {
  failedLogins: [
    AUDIT_ACTIONS.AUTH_LOGIN_FAILURE,
    AUDIT_ACTIONS.AUTH_LOGIN_LOCKED,
    AUDIT_ACTIONS.AUTH_2FA_CHALLENGE_FAILURE,
    AUDIT_ACTIONS.AUTH_2FA_LOCKED,
  ],
};

/**
 * The event-type dropdown, grouped by the action's domain prefix so ~50
 * entries stay scannable. Derived from the canonical vocabulary: a new action
 * in `@repo/shared/audit` appears here without a second list to maintain (its
 * label falls back to the raw action name until the strings table learns it).
 */
export const AUDIT_ACTION_GROUPS: readonly { key: string; actions: readonly AuditAction[] }[] =
  (() => {
    const groups = new Map<string, AuditAction[]>();
    for (const action of Object.values(AUDIT_ACTIONS)) {
      const domain = action.split('.')[0] ?? action;
      const bucket = groups.get(domain);
      if (bucket) {
        bucket.push(action);
      } else {
        groups.set(domain, [action]);
      }
    }
    return [...groups.entries()].map(([key, actions]) => ({ key, actions }));
  })();

/**
 * The key of an action in `auditStrings.actions`. Dots would nest (and
 * `auth.logout` is both a leaf and a prefix of `auth.logout.all`), so the keys
 * flatten them to underscores.
 */
export function auditActionKey(action: string): string {
  return action.replaceAll('.', '_');
}

/**
 * The label of an action. An action the table does not know yet renders as its
 * raw name instead of a bare key.
 */
export function auditActionLabel(action: string): string {
  return labelFor(auditStrings.actions, auditActionKey(action), action);
}

/** The label of a targetType, falling back to the raw type name. */
export function auditTargetLabel(targetType: string): string {
  return labelFor(auditStrings.targetTypes, targetType);
}

/** The label of an action group (the domain prefix), falling back to the prefix. */
export function auditActionGroupLabel(group: string): string {
  return labelFor(auditStrings.actionGroups, group);
}

const DANGER_MARKERS = [
  '.failure',
  '.locked',
  '.deleted',
  '.admin_deleted',
  '.purged',
  '.revoked',
  '.disabled',
  '.terminated',
  '.unlink',
];

/**
 * Sensitive ACCESS, not an error: the row records that somebody was shown
 * something, and the screen states it rather than celebrating it. Exact action
 * names, checked before the success markers, which is what lets an exact match
 * beat a suffix. None of the platform's actions is one yet.
 */
const WARNING_MARKERS: readonly string[] = [];

const SUCCESS_MARKERS = [
  '.created',
  '.success',
  '.enabled',
  '.verified',
  '.rehired',
  '.handled',
  '.renewed',
];

/**
 * Map an action onto the shared pill vocabulary. A failed row is always
 * danger; sensitive access is warning (not an error); creations and successes
 * are success; everything else is stated, not alerted on. `.unhandled` is
 * checked before the success markers so it does not match `.handled` by suffix.
 */
export function auditActionTone(action: string, success: boolean): StatusTone {
  if (!success) return 'danger';
  if (action.endsWith('.unhandled')) return 'neutral';
  if (DANGER_MARKERS.some((marker) => action.includes(marker))) return 'danger';
  if (WARNING_MARKERS.some((marker) => action === marker)) return 'warning';
  if (SUCCESS_MARKERS.some((marker) => action.includes(marker))) return 'success';
  return 'neutral';
}
