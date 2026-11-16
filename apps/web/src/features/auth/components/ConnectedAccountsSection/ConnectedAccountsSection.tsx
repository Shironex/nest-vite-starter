import { Link2, Loader2, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@repo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/card';
import { ListSurface } from '@repo/ui/list-surface';
import { ConfirmPasswordDialog } from '../ConfirmPasswordDialog';
import { useConnectedAccountsSection } from './ConnectedAccountsSection.hooks';

/**
 * The Connected Accounts settings panel (SPEC section 9 item 5): the linked
 * sign-in methods with unlink, plus a link action per enabled-but-unlinked
 * provider. Row anatomy follows SecurityCard, the sibling settings panel: an
 * icon tile, a strong title, muted supporting lines, the action on the right.
 *
 * Rows are keyed by the OAuthAccount id: two Google rows are legal, and the
 * e-mail line is what tells them apart.
 */

/** `Button/Ghost` in the danger tone, matching SecurityCard's row action. */
const DANGER_GHOST_CLASS = 'text-danger hover:bg-danger-bg hover:text-danger';

/**
 * The shared list surface, with its card chrome removed. This panel already
 * sits inside a `Card`; what is wanted from the surface here is its state
 * machine, so loading, empty and error REPLACE the rows the way they do on
 * every other list in the app.
 */
const BARE_SURFACE_CLASS = 'overflow-visible rounded-none border-0 bg-transparent';

const ROW_CLASS = 'flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0';
const TILE_CLASS =
  'flex size-9 shrink-0 items-center justify-center rounded-lg bg-subtle text-text-muted';

export default function ConnectedAccountsSection() {
  const { t } = useTranslation();
  const v = useConnectedAccountsSection();

  const showLinkButtons = v.linkOptions.length > 0;

  const rowItems = v.rows.map((row) => (
    <div key={row.id} className={ROW_CLASS} data-slot="connected-account-row">
      <div className="flex min-w-0 gap-3">
        <span aria-hidden="true" className={TILE_CLASS}>
          <Link2 className="size-4.5" />
        </span>
        <div className="min-w-0 space-y-0.5">
          <p className="type-body-strong text-text">{row.providerName}</p>
          <p className="truncate type-body-small text-text-muted">{row.email}</p>
          <p className="type-body-small text-text-muted">
            {row.linkedOn} &middot; {row.lastUsed}
          </p>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className={DANGER_GHOST_CLASS}
        aria-label={row.unlinkAccessibleLabel}
        disabled={v.isUnlinkPending}
        onClick={() => v.onUnlink(row.id)}
      >
        {v.unlinkingId === row.id && <Loader2 className="animate-spin" />}
        {t('auth.connectedAccounts.unlink')}
      </Button>
    </div>
  ));

  const linkButtons = v.linkOptions.map((option) => (
    <Button key={option.key} variant="outline" onClick={() => v.onLink(option.key)}>
      <Plus />
      {option.label}
    </Button>
  ));

  return (
    <Card data-slot="connected-accounts-section">
      <CardHeader>
        <CardTitle>{t('auth.connectedAccounts.title')}</CardTitle>
        <CardDescription>{t('auth.connectedAccounts.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ListSurface
          className={BARE_SURFACE_CLASS}
          state={v.state}
          loading={<p className="type-body-small text-text-muted">{t('states.loading')}</p>}
          empty={
            <p className="type-body-small text-text-muted">{t('auth.connectedAccounts.empty')}</p>
          }
          error={
            <p className="type-body-small text-danger">{t('auth.connectedAccounts.loadFailed')}</p>
          }
        >
          <div className="divide-y divide-border">{rowItems}</div>
        </ListSurface>

        {showLinkButtons && <div className="flex flex-wrap gap-2">{linkButtons}</div>}

        <ConfirmPasswordDialog
          open={v.isDialogOpen}
          onOpenChange={v.onDialogOpenChange}
          onConfirmed={v.onSudoConfirmed}
        />
      </CardContent>
    </Card>
  );
}
