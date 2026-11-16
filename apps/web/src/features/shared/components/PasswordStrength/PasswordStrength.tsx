import { Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePasswordStrength } from './PasswordStrength.hooks';
import type { IPasswordStrengthProps } from './PasswordStrength.types';

export default function PasswordStrength({ password }: IPasswordStrengthProps) {
  const { t } = useTranslation();
  const { requirements } = usePasswordStrength(password);
  const items = requirements.map((req) => (
    <li key={req.label} className="flex items-center gap-2">
      {req.met ? (
        <Check className="size-4 text-success" />
      ) : (
        <X className="size-4 text-text-muted" />
      )}
      <span className="sr-only">
        {req.met ? t('passwordStrength.met') : t('passwordStrength.notMet')}
      </span>
      {/* The semantic success token carries its own dark value, so the met
          state needs no hand-paired `dark:` class. */}
      <span className={req.met ? 'text-success' : 'text-text-muted'}>{req.label}</span>
    </li>
  ));

  return <ul className="space-y-1.5 type-body-small">{items}</ul>;
}
