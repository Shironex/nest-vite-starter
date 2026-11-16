import { useTranslation } from 'react-i18next';
import { Button } from '@repo/ui/button';
import { EnrollWizard } from '../EnrollWizard';
import { useEnrollOnlyScreen } from './EnrollOnlyScreen.hooks';

export default function EnrollOnlyScreen() {
  const { t } = useTranslation();
  const { onLogout, isLoggingOut, onEnrollComplete } = useEnrollOnlyScreen();

  return (
    <div className="flex flex-col gap-6" data-slot="two-factor-enroll-only">
      <p className="type-body-small text-text-muted">{t('twoFactor.enrollOnly.hint')}</p>
      <EnrollWizard onComplete={onEnrollComplete} />
      <Button variant="ghost" onClick={onLogout} disabled={isLoggingOut}>
        {t('twoFactor.enrollOnly.signOut')}
      </Button>
    </div>
  );
}
