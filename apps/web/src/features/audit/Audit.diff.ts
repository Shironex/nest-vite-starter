/**
 * Pure helpers that turn the wire's free-form JSON columns (`before`, `after`,
 * `metadata`) into renderable field changes. Kept out of the hooks so the
 * trickiest part of the screen - "show what actually changed, not raw JSON" -
 * is unit-testable without React.
 */
import type { IAuditFieldChange, IAuditMetaEntry } from './Audit.types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * One display string for one JSON leaf. `null`/`undefined` map to null so the
 * caller renders the "-" empty marker; nested structures fall back to compact
 * JSON rather than `[object Object]`.
 */
export function formatDiffValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Field-level before/after pairs from a row's snapshots. Only fields that
 * actually differ make it out - a snapshot that repeats forty unchanged
 * columns must not render as forty changes. Returns [] when neither side is a
 * record (nothing snapshot-shaped to diff).
 */
export function diffSnapshots(before: unknown, after: unknown): IAuditFieldChange[] {
  const beforeRecord = isRecord(before) ? before : null;
  const afterRecord = isRecord(after) ? after : null;
  if (beforeRecord === null && afterRecord === null) return [];

  const keys = [
    ...new Set([...Object.keys(beforeRecord ?? {}), ...Object.keys(afterRecord ?? {})]),
  ].sort((a, b) => a.localeCompare(b));

  const changes: IAuditFieldChange[] = [];
  for (const key of keys) {
    const beforeValue = formatDiffValue(beforeRecord?.[key]);
    const afterValue = formatDiffValue(afterRecord?.[key]);
    if (beforeValue !== afterValue) {
      changes.push({ field: key, before: beforeValue, after: afterValue });
    }
  }
  return changes;
}

/**
 * The changed-field NAMES some writers record instead of values (a
 * writer that keeps PII out of the trail by design records only names, so `metadata.fields` is often
 * the only "what changed" a row carries).
 */
export function changedFieldNames(metadata: unknown): string[] {
  if (!isRecord(metadata)) return [];
  const fields = metadata['fields'];
  if (!Array.isArray(fields)) return [];
  return fields.filter((field): field is string => typeof field === 'string');
}

/**
 * The remaining metadata as display pairs, minus the keys other parts of the
 * row already surface (`fields` becomes the changed-fields chips).
 */
export function metadataEntries(metadata: unknown): IAuditMetaEntry[] {
  if (!isRecord(metadata)) return [];
  return Object.entries(metadata)
    .filter(([key]) => key !== 'fields')
    .map(([key, value]) => ({ key, value: formatDiffValue(value) ?? '-' }));
}
