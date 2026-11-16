import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/card';
import { Button } from '@repo/ui/button';
import { Badge } from '@repo/ui/badge';
import { Skeleton } from '@repo/ui/skeleton';
import { RefreshCw, Loader2 } from 'lucide-react';
import { useUpdatesSection } from './UpdatesSection.hooks';

/** Secondary line under a control: the ramp's smallest label, muted. */
const HINT_CLASS = 'type-label-caption text-text-muted';

export default function UpdatesSection() {
  const { t } = useTranslation();
  const {
    status,
    appVersion,
    updateVersionLabel,
    channel,
    handleCheckForUpdates,
    handleDownloadUpdate,
    handleChannelChange,
    handleInstallUpdate,
  } = useUpdatesSection();

  const channelDescription =
    channel === 'stable' ? t('settings.updates.stableHint') : t('settings.updates.betaHint');
  const channelLabel = t(`settings.updates.channels.${channel}`);
  // Leading space so "Update v1.2.3" and the label-less "Update"
  // both read correctly out of the one interpolated string.
  const versionSuffix = updateVersionLabel ? ` ${updateVersionLabel}` : '';

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.updates.title')}</CardTitle>
        <CardDescription>{t('settings.updates.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current version */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="type-body-medium text-text">
              {t('settings.updates.currentVersion')}
            </span>
            {appVersion === null ? (
              <Skeleton className="h-4 w-16" />
            ) : (
              <p className={HINT_CLASS}>
                {appVersion === 'Unknown' ? t('settings.updates.versionUnknown') : `v${appVersion}`}
              </p>
            )}
          </div>
          {/* `Badge` is already `type-label-caption`; it needs no size class. */}
          <Badge variant="outline">{channelLabel}</Badge>
        </div>

        {/* Channel toggle */}
        <div className="space-y-2">
          <span id="release-channel-label" className="block type-body-medium text-text">
            {t('settings.updates.releaseChannel')}
          </span>
          <div className="flex gap-2" role="group" aria-labelledby="release-channel-label">
            <Button
              variant={channel === 'stable' ? 'default' : 'outline'}
              size="sm"
              aria-pressed={channel === 'stable'}
              onClick={() => handleChannelChange('stable')}
            >
              {t('settings.updates.channels.stable')}
            </Button>
            <Button
              variant={channel === 'beta' ? 'default' : 'outline'}
              size="sm"
              aria-pressed={channel === 'beta'}
              onClick={() => handleChannelChange('beta')}
            >
              {t('settings.updates.channels.beta')}
            </Button>
          </div>
          <p className={HINT_CLASS}>{channelDescription}</p>
        </div>

        {/* Check for updates */}
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCheckForUpdates}
            disabled={status === 'checking' || status === 'downloading'}
          >
            {status === 'checking' ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
            )}
            {t('settings.updates.check')}
          </Button>

          {/* Status indicators */}
          <div role="status" aria-live="polite" className="flex items-center gap-2">
            {status === 'not-available' && (
              <span className={HINT_CLASS}>{t('settings.updates.upToDate')}</span>
            )}
            {status === 'available' && (
              <div className="flex items-center gap-2">
                <span className="type-label-caption text-brand-ink">
                  {t('settings.updates.available', { version: versionSuffix })}
                </span>
                <Button variant="default" size="sm" onClick={handleDownloadUpdate}>
                  {t('settings.updates.download')}
                </Button>
              </div>
            )}
            {status === 'downloading' && (
              <span className="type-label-caption text-brand-ink">
                {t('settings.updates.downloading')}
              </span>
            )}
            {status === 'downloaded' && (
              <div className="flex items-center gap-2">
                <span className="type-label-caption text-success">
                  {t('settings.updates.ready', { version: versionSuffix })}
                </span>
                <Button variant="default" size="sm" onClick={handleInstallUpdate}>
                  {t('settings.updates.restart')}
                </Button>
              </div>
            )}
            {status === 'error' && (
              <span className="type-label-caption text-danger">
                {t('settings.updates.checkFailed')}
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
