import { useTranslation } from 'react-i18next';
import { cn } from '@repo/ui/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/card';
import { Badge } from '@repo/ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '@repo/ui/avatar';
import { Skeleton } from '@repo/ui/skeleton';
import { FileUploadZone } from '@/features/shared/components/FileUploadZone';
import { ALLOWED_IMAGE_ACCEPT } from '@repo/shared/schemas';
import { MAX_FILE_SIZE } from '@repo/shared/constants';
import { useProfileSection } from './ProfileSection.hooks';

/** Field label above each read-only value, per the design's 64px field rhythm. */
const FIELD_LABEL_CLASS = 'type-label-caption text-text-muted';
const FIELD_VALUE_CLASS = 'type-body-regular text-text';

export default function ProfileSection() {
  const { t } = useTranslation();
  const view = useProfileSection();

  if (!view) return null;

  const {
    displayName,
    email,
    role,
    emailVerified,
    initials,
    displayAvatarUrl,
    avatarLoading,
    avatarError,
    onUploadComplete,
    onUploadError,
  } = view;

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
        <CardTitle>{t('settings.profile.title')}</CardTitle>
        <CardDescription>{t('settings.profile.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Avatar upload section */}
        <div className="grid gap-2">
          <span className={FIELD_LABEL_CLASS}>{t('settings.profile.avatar')}</span>
          <div className="flex items-start gap-4">
            {avatarLoading ? (
              <Skeleton className="size-16 rounded-full" />
            ) : (
              <Avatar size="lg" className="size-16">
                {/* On lookup failure, skip the image and fall back to initials. */}
                {displayAvatarUrl && !avatarError ? (
                  <AvatarImage src={displayAvatarUrl} alt={t('settings.profile.avatarAlt')} />
                ) : null}
                <AvatarFallback className="type-heading-h3">{initials}</AvatarFallback>
              </Avatar>
            )}
            <div className="flex-1">
              <FileUploadZone
                onUploadComplete={onUploadComplete}
                onUploadError={onUploadError}
                accept={ALLOWED_IMAGE_ACCEPT}
                maxSize={MAX_FILE_SIZE}
                maxFiles={1}
              />
            </div>
          </div>
        </div>

        <div className="grid gap-1">
          <span className={FIELD_LABEL_CLASS}>{t('settings.profile.email')}</span>
          <div className="flex items-center gap-2">
            <span className={FIELD_VALUE_CLASS}>{email}</span>
            <Badge variant="secondary" className={verificationClass}>
              {emailVerified ? t('settings.profile.verified') : t('settings.profile.unverified')}
            </Badge>
          </div>
        </div>

        <div className="grid gap-1">
          <span className={FIELD_LABEL_CLASS}>{t('settings.profile.displayName')}</span>
          <span className={FIELD_VALUE_CLASS}>{displayName}</span>
        </div>

        <div className="grid gap-1">
          <span className={FIELD_LABEL_CLASS}>{t('settings.profile.role')}</span>
          <span className={cn(FIELD_VALUE_CLASS, 'capitalize')}>{role}</span>
        </div>
      </CardContent>
    </Card>
  );
}
