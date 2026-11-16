/**
 * Every rail row `/settings` can show, by the id the rail selects it with.
 *
 * One list for two readers: the route builds its sections from these ids, and
 * its `validateSearch` accepts `?section=` only when the value is one of them
 * (`isSettingsSectionId` in Settings.util.ts), so a deep link can never name
 * a row the route does not know. A row that exists here but is hidden for
 * this user (`members` for a non-admin, `updates` outside Electron) is still
 * a valid value: the shell falls back to the first row for an id it cannot
 * find, exactly as for any stale id.
 */
export const SETTINGS_SECTION = {
  profile: 'profile',
  members: 'members',
  notifications: 'notifications',
  security: 'security',
  appearance: 'appearance',
  help: 'help',
  updates: 'updates',
} as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION)[keyof typeof SETTINGS_SECTION];
