import { PASSWORD_REQUIREMENTS } from '@repo/shared/schemas';
import { commonStrings } from '@/lib/strings';
import type { IPasswordStrengthView } from './PasswordStrength.types';

// The shared list carries English source labels and no stable ids, so the
// strings table is keyed off those labels here. A requirement added to
// @repo/shared without a mapping falls back to its own label.
const REQUIREMENT_LABELS: Record<string, string> = {
  'At least 8 characters': commonStrings.passwordStrength.requirements.minLength,
  'Uppercase letter': commonStrings.passwordStrength.requirements.uppercase,
  'Lowercase letter': commonStrings.passwordStrength.requirements.lowercase,
  Number: commonStrings.passwordStrength.requirements.number,
  'Special character': commonStrings.passwordStrength.requirements.special,
};

// The checklist mirrors the zod passwordSchema exactly because both are built
// from the same PASSWORD_REQUIREMENTS list in @repo/shared.
export function usePasswordStrength(password: string): IPasswordStrengthView {
  const requirements = PASSWORD_REQUIREMENTS.map((req) => {
    return {
      label: REQUIREMENT_LABELS[req.label] ?? req.label,
      met: password.length > 0 && req.regex.test(password),
    };
  });
  return { requirements };
}
