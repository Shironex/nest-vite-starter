import { ShieldAlert } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@repo/ui/button';
import { useGraceBanner } from './GraceBanner.hooks';

export default function GraceBanner() {
  const { t } = useTranslation();
  const { show, deadlineLabel } = useGraceBanner();
  if (!show) return null;

  const deadlineText = deadlineLabel
    ? t('twoFactor.graceBanner.deadline', { date: deadlineLabel })
    : t('twoFactor.graceBanner.noDeadline');

  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-3 rounded-xl border border-warning/50 bg-warning-bg px-4 py-3 type-body-regular"
      data-slot="two-factor-grace-banner"
    >
      <ShieldAlert className="size-5 shrink-0 text-warning" />
      <div className="flex-1">
        <p className="type-body-medium">{t('twoFactor.graceBanner.title')}</p>
        <p className="text-muted-foreground">{deadlineText}</p>
      </div>
      <Button asChild size="sm">
        {/* Straight to the rail row that holds 2FA setup, not the default Profile row. */}
        <Link to="/settings" search={{ section: 'security' }}>
          {t('twoFactor.graceBanner.cta')}
        </Link>
      </Button>
    </div>
  );
}
