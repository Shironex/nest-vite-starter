import { i18n } from './i18n';

/**
 * Format a timestamp as a human-readable relative time string.
 * E.g. "just now", "5m ago", "2h ago", "3d ago".
 */
export function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return i18n.t('common:time.justNow');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return i18n.t('common:time.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return i18n.t('common:time.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  return i18n.t('common:time.daysAgo', { count: days });
}
