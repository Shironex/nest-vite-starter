import { Download, RefreshCw, AlertCircle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUpdateBanner } from './UpdateBanner.hooks';

/**
 * Electron-only status band, rendered directly under the TitleBar.
 *
 * The band is the design system's brand-tint plate (`bg-brand-tint` +
 * `text-brand-ink`), the same pairing the sidebar uses for its active item,
 * rather than a `bg-primary/10` alpha wash. An alpha over an unknown backdrop
 * is the classic surface that looks right in one theme and washes out in the
 * other; the tint token is authored per mode so it holds in both.
 *
 * The label is `type-label-caption` (12px/500), which WCAG counts as small
 * text, so the ink has to be `text-brand-ink` and not `text-brand`. The
 * pairing is asserted by `scripts/check-contrast.mjs` (`pnpm check:contrast`).
 */
export default function UpdateBanner() {
  const { t } = useTranslation();
  const view = useUpdateBanner();

  if (!view) return null;

  const { status, versionLabel, progressLabel, errorLabel, onDownload, onRestart, onDismiss } =
    view;

  return (
    <div className="flex h-8 w-full shrink-0 items-center justify-between bg-brand-tint px-4 type-label-caption text-brand-ink">
      <div className="flex items-center gap-2">
        {status === 'available' && (
          <>
            <Download className="h-3.5 w-3.5" />
            <span>
              {t('desktop.updateBanner.available', { version: versionLabel })}{' '}
              <button
                type="button"
                onClick={onDownload}
                className="rounded-sm underline underline-offset-2 hover:text-brand-ink-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {t('desktop.updateBanner.download')}
              </button>
            </span>
          </>
        )}
        {status === 'downloading' && (
          <>
            <Download className="h-3.5 w-3.5 animate-pulse" />
            <span>
              {t('desktop.updateBanner.downloading', { version: versionLabel })} {progressLabel}
            </span>
          </>
        )}
        {status === 'downloaded' && (
          <>
            <RefreshCw className="h-3.5 w-3.5" />
            <span>
              {t('desktop.updateBanner.ready', { version: versionLabel })}{' '}
              <span className="text-text-muted">·</span>{' '}
              <button
                type="button"
                onClick={onRestart}
                className="rounded-sm underline underline-offset-2 hover:text-brand-ink-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {t('desktop.updateBanner.restart')}
              </button>
            </span>
          </>
        )}
        {status === 'error' && (
          <>
            <AlertCircle className="h-3.5 w-3.5" />
            <span>{t('desktop.updateBanner.failed', { error: errorLabel })}</span>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-sm p-0.5 transition-colors hover:text-brand-ink-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={t('desktop.updateBanner.dismiss')}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
