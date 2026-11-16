import { cn } from '@repo/ui/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/card';
import { Badge } from '@repo/ui/badge';
import { Avatar, AvatarFallback } from '@repo/ui/avatar';
import { useProfileSection } from './ProfileSection.hooks';
import { settingsStrings } from '@/features/settings/Settings.strings';

/** Field label above each read-only value, per the design's 64px field rhythm. */
const FIELD_LABEL_CLASS = 'type-label-caption text-text-muted';
const FIELD_VALUE_CLASS = 'type-body-regular text-text';

export default function ProfileSection() {
  const view = useProfileSection();

  if (!view) return null;

  const { displayName, email, role, emailVerified, initials } = view;

  /*
   * The verified/unverified pair rides the semantic success and warning
   * tokens. Both carry their own dark values, so neither state needs a
   * hand-paired `dark:` class.
   */
  const verificationClass = emailVerified
    ? 'bg-success-bg text-success'
    : 'bg-warning-bg text-warning';

  return (
    <Card>
      <CardHeader>
        <CardTitle>{settingsStrings.profile.title}</CardTitle>
        <CardDescription>{settingsStrings.profile.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-2">
          <span className={FIELD_LABEL_CLASS}>{settingsStrings.profile.avatar}</span>
          <Avatar size="lg" className="size-16">
            <AvatarFallback className="type-heading-h3">{initials}</AvatarFallback>
          </Avatar>
        </div>

        <div className="grid gap-1">
          <span className={FIELD_LABEL_CLASS}>{settingsStrings.profile.email}</span>
          <div className="flex items-center gap-2">
            <span className={FIELD_VALUE_CLASS}>{email}</span>
            <Badge variant="secondary" className={verificationClass}>
              {emailVerified
                ? settingsStrings.profile.verified
                : settingsStrings.profile.unverified}
            </Badge>
          </div>
        </div>

        <div className="grid gap-1">
          <span className={FIELD_LABEL_CLASS}>{settingsStrings.profile.displayName}</span>
          <span className={FIELD_VALUE_CLASS}>{displayName}</span>
        </div>

        <div className="grid gap-1">
          <span className={FIELD_LABEL_CLASS}>{settingsStrings.profile.role}</span>
          <span className={cn(FIELD_VALUE_CLASS, 'capitalize')}>{role}</span>
        </div>
      </CardContent>
    </Card>
  );
}
