import type { LucideIcon } from 'lucide-react';
import { FileText, MonitorSmartphone, ShieldCheck } from 'lucide-react';
import { cn } from '@repo/ui/lib/utils';
import { Button } from '@repo/ui/button';
import { Badge } from '@repo/ui/badge';
import { Separator } from '@repo/ui/separator';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/card';
import { Skeleton } from '@repo/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/dialog';
import { EnrollWizard } from '../EnrollWizard';
import { DisableDialog } from '../DisableDialog';
import { RegenerateDialog } from '../RegenerateDialog';
import { useSecurityCard } from './SecurityCard.hooks';
import { twoFactorStrings } from '@/features/two-factor/TwoFactor.strings';
import { commonStrings } from '@/lib/strings';

/**
 * The account-security panel, built to the design: divider-separated rows, each an icon tile
 * plus a title, a supporting line, and its action on the right.
 *
 * THE DESIGN'S THIRD ROW IS NOT HERE. The design draws an "Active sessions" row
 * ("3 devices signed in to this account") with a Manage action. There is no
 * session-listing procedure behind it, so the row is absent rather than filled
 * with an invented count. `Trusted browsers` below is a different, real thing:
 * the devices that may skip the second factor, not the sessions that are
 * signed in.
 */

/**
 * `Button/Soft` from the design: brand tint, brand label, no border. `@repo/ui`
 * has no `soft` variant yet, so it is composed here on top of `ghost` rather
 * than added to the shared button (that belongs to the `@repo/ui` pass, D08).
 */
const SOFT_BUTTON_CLASS = 'bg-brand-50 text-brand-ink hover:bg-brand-100 hover:text-brand-ink';

/** `Button/Ghost` in the danger tone, used for the destructive row action. */
const DANGER_GHOST_CLASS = 'text-danger hover:bg-danger-bg hover:text-danger';

const ROW_CLASS = 'flex items-start justify-between gap-4';
const TILE_BASE_CLASS = 'flex size-9 shrink-0 items-center justify-center rounded-lg';

function RowIcon({ icon: Icon, isPrimary }: { icon: LucideIcon; isPrimary?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        TILE_BASE_CLASS,
        isPrimary ? 'bg-brand-50 text-brand-ink' : 'bg-subtle text-text-muted',
      )}
    >
      <Icon className="size-4.5" />
    </span>
  );
}

export default function SecurityCard() {
  const v = useSecurityCard();

  const enabled = v.status?.enabled ?? false;
  const remaining = v.status?.recoveryCodesRemaining ?? 0;
  const lowCodes = v.status?.lowRecoveryCodes ?? false;
  const trustedCount = v.status?.trustedDeviceCount ?? 0;
  const showDisabledState = !v.isLoading && !enabled;
  const showEnabledState = !v.isLoading && enabled;
  const revokeDisabled = v.isRevoking || trustedCount === 0;
  const statusLabel = enabled
    ? twoFactorStrings.securityCard.statusOn
    : twoFactorStrings.securityCard.statusOff;
  // The design's `Badge/Success` for the on state; neutral otherwise.
  const statusBadgeClass = enabled ? 'bg-success-bg text-success' : undefined;

  return (
    <Card data-slot="two-factor-security-card">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="space-y-1">
            <CardTitle>{twoFactorStrings.securityCard.title}</CardTitle>
            <CardDescription>{twoFactorStrings.securityCard.description}</CardDescription>
          </div>
          {/*
           * The badge waits for the query, unlike the `?? false` defaults
           * above. Rendered eagerly it said "Off" to a user who HAS 2FA
           * on, for the length of the fetch, and then flipped to the green
           * "On": the card announced the opposite of the truth about
           * their own account security before correcting itself.
           */}
          {v.isLoading ? (
            <Skeleton className="h-5 w-20 rounded-full" />
          ) : (
            <Badge variant="secondary" className={statusBadgeClass}>
              {statusLabel}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {v.isLoading && (
          <p className="type-body-small text-text-muted">{commonStrings.states.loading}</p>
        )}

        {showDisabledState && (
          <div className="space-y-3">
            <p className="type-body-small text-text-muted">
              {twoFactorStrings.securityCard.disabledHint}
            </p>
            <Button onClick={() => v.onEnrollOpenChange(true)}>
              {twoFactorStrings.securityCard.enableCta}
            </Button>
          </div>
        )}

        {showEnabledState && (
          <div className="space-y-4">
            <div className={ROW_CLASS}>
              <div className="flex min-w-0 gap-3">
                <RowIcon icon={ShieldCheck} isPrimary />
                <div className="min-w-0 space-y-0.5">
                  <p className="type-body-strong text-text">
                    {twoFactorStrings.securityCard.authenticatorTitle}
                  </p>
                  <p className="type-body-small text-text-muted">
                    {twoFactorStrings.securityCard.authenticatorHint}
                  </p>
                </div>
              </div>
              {/*
                Short visible label per the design, with the object of the verb
                added to the accessible name so the button still reads
                unambiguously outside the context of its row. The visible text
                stays a prefix of the accessible name, which is what keeps
                "click Turn off" working for voice control (WCAG 2.5.3).
              */}
              <Button
                variant="ghost"
                size="sm"
                className={DANGER_GHOST_CLASS}
                aria-label={twoFactorStrings.securityCard.turnOffAccessible}
                onClick={() => v.onDisableOpenChange(true)}
              >
                {twoFactorStrings.securityCard.turnOff}
              </Button>
            </div>

            <Separator />

            <div className={ROW_CLASS}>
              <div className="flex min-w-0 gap-3">
                <RowIcon icon={FileText} />
                <div className="min-w-0 space-y-0.5">
                  <p className="type-body-strong text-text">
                    {twoFactorStrings.securityCard.recoveryTitle}
                  </p>
                  <p className="type-body-small text-text-muted">
                    {twoFactorStrings.securityCard.recoveryRemaining(remaining)}
                  </p>
                  {lowCodes && (
                    <p className="type-body-small text-warning">
                      {twoFactorStrings.securityCard.recoveryLow}
                    </p>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className={SOFT_BUTTON_CLASS}
                onClick={() => v.onRegenerateOpenChange(true)}
              >
                {twoFactorStrings.securityCard.regenerate}
              </Button>
            </div>

            <Separator />

            <div className={ROW_CLASS}>
              <div className="flex min-w-0 gap-3">
                <RowIcon icon={MonitorSmartphone} />
                <div className="min-w-0 space-y-0.5">
                  <p className="type-body-strong text-text">
                    {twoFactorStrings.securityCard.trustedTitle}
                  </p>
                  <p className="type-body-small text-text-muted">
                    {twoFactorStrings.securityCard.trustedCount(trustedCount)}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className={SOFT_BUTTON_CLASS}
                disabled={revokeDisabled}
                onClick={v.onRevokeTrusted}
              >
                {twoFactorStrings.securityCard.revokeAll}
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={v.isEnrollOpen} onOpenChange={v.onEnrollOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{twoFactorStrings.securityCard.enrollDialogTitle}</DialogTitle>
            <DialogDescription>
              {twoFactorStrings.securityCard.enrollDialogDescription}
            </DialogDescription>
          </DialogHeader>
          <EnrollWizard onComplete={v.onEnrollComplete} />
        </DialogContent>
      </Dialog>

      <DisableDialog open={v.isDisableOpen} onOpenChange={v.onDisableOpenChange} />
      <RegenerateDialog open={v.isRegenerateOpen} onOpenChange={v.onRegenerateOpenChange} />
    </Card>
  );
}
