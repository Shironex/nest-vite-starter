import { SETTINGS_SECTION } from './Settings.constants';
import type { SettingsSectionId } from './Settings.constants';

const SETTINGS_SECTION_IDS: readonly string[] = Object.values(SETTINGS_SECTION);

/** True when `value` names a settings rail row, so a search param can be trusted. */
export function isSettingsSectionId(value: unknown): value is SettingsSectionId {
  return typeof value === 'string' && SETTINGS_SECTION_IDS.includes(value);
}
