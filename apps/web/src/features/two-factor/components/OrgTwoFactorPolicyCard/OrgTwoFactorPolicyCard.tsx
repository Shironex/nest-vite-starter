import { useTranslation } from 'react-i18next';
import { Badge } from '@repo/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/card';
import { Label } from '@repo/ui/label';
import { Switch } from '@repo/ui/switch';
import { Skeleton } from '@repo/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@repo/ui/alert-dialog';
import { useOrgTwoFactorPolicyCard } from './OrgTwoFactorPolicyCard.hooks';

export default function OrgTwoFactorPolicyCard() {
  const { t } = useTranslation();
  const v = useOrgTwoFactorPolicyCard();

  /*
   * One tinted-pill language for policy state, matching the badge on
   * `SecurityCard` and the 2FA column of `MembersSection`. All three render in
   * the same panel, so a solid destructive chip beside two tinted ones would
   * read as a second design system.
   */
  const badgeClass = v.enforced
    ? 'bg-danger-bg text-danger'
    : v.required
      ? 'bg-warning-bg text-warning'
      : undefined;
  const badgeLabel = v.enforced
    ? t('twoFactor.orgPolicy.badgeEnforcing')
    : v.required
      ? t('twoFactor.orgPolicy.badgeGrace')
      : t('twoFactor.orgPolicy.badgeOff');

  return (
    <Card data-slot="org-two-factor-policy-card">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>{t('twoFactor.orgPolicy.title')}</CardTitle>
            <CardDescription>{t('twoFactor.orgPolicy.description')}</CardDescription>
          </div>
          {/*
           * The badge waits for getTenantPolicy, unlike the `?? false`
           * defaults it reads. Rendered eagerly, an admin of a tenant that
           * ENFORCES 2FA saw "Off" on every open of the panel before it
           * flipped to "Enforcing": the card stated the opposite of the policy
           * it exists to report.
           */}
          {v.isLoading ? (
            <Skeleton className="h-5 w-24 rounded-full" />
          ) : (
            <Badge variant="secondary" className={badgeClass}>
              {badgeLabel}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {v.isLoading && <p className="type-body-small text-text-muted">{t('states.loading')}</p>}

        {!v.isLoading && (
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="org-2fa-required">{v.statusText}</Label>
              {v.deadlineText && (
                <p className="type-body-small text-text-muted">{v.deadlineText}</p>
              )}
            </div>
            <Switch
              id="org-2fa-required"
              checked={v.required}
              disabled={v.isPending}
              onCheckedChange={v.onToggle}
              aria-label={t('twoFactor.orgPolicy.switchLabel')}
            />
          </div>
        )}
      </CardContent>

      <AlertDialog open={v.confirmEnableOpen} onOpenChange={v.onConfirmEnableOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('twoFactor.orgPolicy.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('twoFactor.orgPolicy.confirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={v.isPending}>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={v.onConfirmEnable} disabled={v.isPending}>
              {t('twoFactor.orgPolicy.confirmCta')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
