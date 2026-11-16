import { useTranslation } from 'react-i18next';
import { PASSWORD_REQUIREMENTS } from '@repo/shared/schemas';
import type { IPasswordStrengthView } from './PasswordStrength.types';

// The shared list carries English source labels and no stable ids, so the
// catalog is keyed off those labels here. A requirement added to
// @repo/shared without a mapping falls back to its English label instead of
// rendering a raw key.
const REQUIREMENT_LABEL_KEYS: Record<string, string> = {
  'At least 8 characters': 'passwordStrength.requirements.minLength',
  'Uppercase letter': 'passwordStrength.requirements.uppercase',
  'Lowercase letter': 'passwordStrength.requirements.lowercase',
  Number: 'passwordStrength.requirements.number',
  'Special character': 'passwordStrength.requirements.special',
};

// The checklist mirrors the zod passwordSchema exactly because both are built
// from the same PASSWORD_REQUIREMENTS list in @repo/shared.
export function usePasswordStrength(password: string): IPasswordStrengthView {
  const { t } = useTranslation();
  const requirements = PASSWORD_REQUIREMENTS.map((req) => {
    const labelKey = REQUIREMENT_LABEL_KEYS[req.label];
    return {
      label: labelKey ? t(labelKey) : req.label,
      met: password.length > 0 && req.regex.test(password),
    };
  });
  return { requirements };
}
