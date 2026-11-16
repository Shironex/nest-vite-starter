import { Loader2, Monitor, Smartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@repo/ui/alert-dialog';
import { Badge } from '@repo/ui/badge';
import { Button } from '@repo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/card';
import { ListSurface } from '@repo/ui/list-surface';
import { useSessionsSection } from './SessionsSection.hooks';

/**
 * The active-sessions settings panel: every device signed in to the account,
 * with per-device sign-out and a confirmed "sign out other sessions" action.
 * Row anatomy follows ConnectedAccountsSection, the sibling security panel:
 * an icon tile, a strong title, muted supporting lines, the action on the
 * right. The current device wears a badge instead of a button: signing THIS
 * device out is what logout is for.
 */

/** `Button/Ghost` in the danger tone, matching the sibling panels' row action. */
const DANGER_GHOST_CLASS = 'text-danger hover:bg-danger-bg hover:text-danger';

const ROW_CLASS = 'flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0';
const TILE_CLASS =
  'flex size-9 shrink-0 items-center justify-center rounded-lg bg-subtle text-text-muted';

/** The same brand tint the settings rail uses for its active row. */
const CURRENT_BADGE_CLASS = 'bg-brand-50 text-brand-ink';

/**
 * The shared list surface, with its card chrome removed.
 *
 * This panel already sits inside a `Card`, so the surface's own border and
 * radius would be a second frame around the first. What is wanted here is the
 * other half of it: one state machine, so loading, empty and error REPLACE the
 * rows the way they do on every other list in the app rather than each panel
 * hand-rolling three `<p>` tags.
 */
const BARE_SURFACE_CLASS = 'overflow-visible rounded-none border-0 bg-transparent';

export default function SessionsSection() {
  const { t } = useTranslation();
  const v = useSessionsSection();

  const showRevokeOthers = v.state === 'ready' && v.hasOtherSessions;

  const rowItems = v.rows.map((row) => (
    <div key={row.id} className={ROW_CLASS} data-slot="session-row">
      <div className="flex min-w-0 gap-3">
        <span aria-hidden="true" className={TILE_CLASS}>
          {row.isMobile ? <Smartphone className="size-4.5" /> : <Monitor className="size-4.5" />}
        </span>
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="type-body-strong text-text">{row.deviceLabel}</p>
            {row.isCurrent && (
              <Badge variant="secondary" className={CURRENT_BADGE_CLASS}>
                {t('sessions.thisDevice')}
              </Badge>
            )}
          </div>
          <p className="truncate type-body-small text-text-muted">{row.ip}</p>
          <p className="type-body-small text-text-muted">
            {row.signedIn} &middot; {row.lastActive}
          </p>
        </div>
      </div>
      {!row.isCurrent && (
        <Button
          variant="ghost"
          size="sm"
          className={DANGER_GHOST_CLASS}
          aria-label={row.revokeAccessibleLabel}
          disabled={v.isRevokePending}
          onClick={() => v.onRevoke(row.id)}
        >
          {v.revokingId === row.id && <Loader2 className="animate-spin" />}
          {t('sessions.revoke')}
        </Button>
      )}
    </div>
  ));

  return (
    <Card data-slot="sessions-section">
      <CardHeader>
        <CardTitle>{t('sessions.title')}</CardTitle>
        <CardDescription>{t('sessions.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ListSurface
          className={BARE_SURFACE_CLASS}
          state={v.state}
          loading={<p className="type-body-small text-text-muted">{t('states.loading')}</p>}
          empty={<p className="type-body-small text-text-muted">{t('sessions.empty')}</p>}
          error={<p className="type-body-small text-danger">{t('sessions.loadFailed')}</p>}
        >
          <div className="divide-y divide-border">{rowItems}</div>
        </ListSurface>

        {showRevokeOthers && (
          <AlertDialog open={v.isConfirmOpen} onOpenChange={v.onConfirmOpenChange}>
            <AlertDialogTrigger asChild>
              <Button variant="outline">{t('sessions.revokeOthers')}</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('sessions.revokeOthersTitle')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('sessions.revokeOthersDescription')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel type="button" disabled={v.isRevokeOthersPending}>
                  {t('actions.cancel')}
                </AlertDialogCancel>
                <Button
                  variant="destructive"
                  disabled={v.isRevokeOthersPending}
                  onClick={v.onRevokeOthers}
                >
                  {v.isRevokeOthersPending && <Loader2 className="animate-spin" />}
                  {t('sessions.revokeOthersConfirm')}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </CardContent>
    </Card>
  );
}
