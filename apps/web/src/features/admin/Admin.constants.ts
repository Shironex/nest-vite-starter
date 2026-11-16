import type { StatusTone } from '@repo/ui/status-pill';
import { labelFor } from '@/lib/strings';
import { adminStrings } from './Admin.strings';

/**
 * The key of an action in `adminStrings.audit.actions`. Dots would nest (and
 * `auth.logout` is both a leaf and a prefix of `auth.logout.all`), so the keys
 * flatten them to underscores.
 */
export function auditActionKey(action: string): string {
  return action.replaceAll('.', '_');
}

/**
 * The label of an action. An action the table does not know yet renders as its
 * raw name instead of a bare key: a row written by a newer server must still
 * render.
 */
export function auditActionLabel(action: string): string {
  return labelFor(adminStrings.audit.actions, auditActionKey(action), action);
}

/** The label of a targetType, falling back to the raw type name. */
export function auditTargetLabel(targetType: string): string {
  return labelFor(adminStrings.audit.targetTypes, targetType);
}

const DANGER_MARKERS = [
  '.failure',
  '.locked',
  '.deleted',
  '.admin_deleted',
  '.purged',
  '.revoked',
  '.disabled',
];

const SUCCESS_MARKERS = ['.created', '.success', '.enabled', '.verified'];

/**
 * Map an action onto the shared pill vocabulary. A failed row is always
 * danger, removals and lockouts are danger, creations and successes are
 * success, and everything else is stated, not alerted on.
 */
export function auditActionTone(action: string, success: boolean): StatusTone {
  if (!success) return 'danger';
  if (DANGER_MARKERS.some((marker) => action.includes(marker))) return 'danger';
  if (SUCCESS_MARKERS.some((marker) => action.includes(marker))) return 'success';
  return 'neutral';
}
