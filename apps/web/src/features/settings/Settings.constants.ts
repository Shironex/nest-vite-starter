/**
 * Every rail row `/settings` can show, by the id the rail selects it with.
 *
 * One list for two readers: the route builds its sections from these ids, and
 * its `validateSearch` accepts `?section=` only when the value is one of them
 * (`isSettingsSectionId` in Settings.util.ts), so a deep link can never name
 * a row the route does not know. The shell falls back to the first row for an
 * id it cannot find, exactly as for any stale id.
 */
export const SETTINGS_SECTION = {
  profile: 'profile',
  security: 'security',
  appearance: 'appearance',
} as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION)[keyof typeof SETTINGS_SECTION];
