import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/card';
import { Skeleton } from '@repo/ui/skeleton';
import { Switch } from '@repo/ui/switch';
import { useNotificationsSection } from './NotificationsSection.hooks';

/**
 * Per-user notification preferences: one row per category, one switch per
 * WIRED channel (see WIRED_CHANNELS in the hook: a row only carries the
 * channels that actually deliver for its category).
 *
 * Every flip saves immediately; there is no Save button. Six independent
 * booleans do not form a draft the way the ladder editor's rung lists do, and
 * an unsaved-changes state on a settings toggle is exactly the "promise the
 * app cannot keep" the rail avoids. The switches disable while a save is in
 * flight so flips serialize instead of racing each other.
 */
export default function NotificationsSection() {
  const { rows, isLoading, hasLoadError, isSaving, labels, onToggle } = useNotificationsSection();

  const rowItems = rows.map((row) => {
    const toggleItems = row.toggles.map((toggle) => (
      <div key={toggle.channel} className="flex items-center justify-between gap-3">
        <label htmlFor={toggle.id} className="type-body-medium text-text">
          {toggle.label}
        </label>
        <Switch
          id={toggle.id}
          checked={toggle.checked}
          disabled={isSaving}
          onCheckedChange={(checked) => onToggle(row.category, toggle.channel, checked)}
        />
      </div>
    ));
    return (
      <div key={row.category} data-slot="notification-prefs-row" className="space-y-3">
        <div>
          <p className="type-body-strong text-text">{row.label}</p>
          <p className="type-label-caption text-text-muted">{row.description}</p>
        </div>
        <div className="space-y-2">{toggleItems}</div>
      </div>
    );
  });

  let content;
  if (isLoading) {
    content = <Skeleton className="h-48 w-full" data-slot="notification-prefs-loading" />;
  } else if (hasLoadError) {
    content = <p className="type-body-medium text-text-secondary">{labels.loadError}</p>;
  } else {
    content = <div className="space-y-6">{rowItems}</div>;
  }

  return (
    <Card data-slot="notification-prefs">
      <CardHeader>
        <CardTitle>{labels.title}</CardTitle>
        <CardDescription>{labels.description}</CardDescription>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}
