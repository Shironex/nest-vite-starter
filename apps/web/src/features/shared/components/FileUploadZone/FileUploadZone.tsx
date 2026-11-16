import { CloudUpload, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@repo/ui/lib/utils';
import { OVERLAY_SCRIM_CLASS } from '@repo/ui/lib/overlay';
import { Button } from '@repo/ui/button';
import { MAX_FILE_SIZE } from '@repo/shared/constants';
import type { IFileUploadZoneProps, IUploadProgress } from './FileUploadZone.types';
import { useFileUploadZone } from './FileUploadZone.hooks';

/** Small muted line: the byte counter, the hint, the Clear affordance. */
const CAPTION_CLASS = 'type-label-caption text-text-muted';

function UploadRow({ upload }: { upload: IUploadProgress }) {
  const hasError = upload.status === 'error' && Boolean(upload.error);
  return (
    <div className="flex items-center gap-2 type-body-regular text-text">
      {upload.status === 'uploading' && <Loader2 className="size-4 animate-spin text-text-muted" />}
      {/* Semantic success/danger tokens, which already carry their dark values. */}
      {upload.status === 'complete' && <CheckCircle2 className="size-4 text-success" />}
      {upload.status === 'error' && <XCircle className="size-4 text-danger" />}

      <span className="min-w-0 flex-1 truncate">{upload.filename}</span>

      {upload.status === 'uploading' && (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-subtle">
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-300"
              style={{ width: `${upload.progress}%` }}
            />
          </div>
          <span className={cn('w-8', CAPTION_CLASS)}>{upload.progress}%</span>
        </div>
      )}

      {hasError && <span className="type-label-caption text-danger">{upload.error}</span>}
    </div>
  );
}

export default function FileUploadZone({
  onUploadComplete,
  onUploadError,
  accept = 'image/*',
  maxSize = MAX_FILE_SIZE,
  maxFiles = 1,
  currentImageUrl,
  className,
}: IFileUploadZoneProps) {
  const { t } = useTranslation();
  const {
    isDragOver,
    uploads,
    isUploading,
    maxSizeMb,
    inputRef,
    handleDrop,
    handleDragOver,
    handleDragLeave,
    handleClick,
    handleInputChange,
    clearUploads,
    allSettled,
  } = useFileUploadZone({ onUploadComplete, onUploadError, maxSize, maxFiles });

  const uploadRows = uploads.map((upload) => <UploadRow key={upload.id} upload={upload} />);

  return (
    <div className={cn('space-y-3', className)}>
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label={t('upload.dropZoneLabel')}
        aria-busy={isUploading}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
        className={cn(
          'relative flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
          isDragOver ? 'border-brand bg-brand-50' : 'border-border-strong hover:border-brand',
          isUploading && 'pointer-events-none opacity-60',
        )}
      >
        {currentImageUrl ? (
          <div className="group relative">
            <img
              src={currentImageUrl}
              alt={t('upload.currentAvatar')}
              className="size-20 rounded-full object-cover"
            />
            {/*
              A scrim over the user's own photo, so it stays dark in both
              themes: the same `OVERLAY_SCRIM_CLASS` the dialog and drawer
              overlays use, which the collection has no variable for yet.
            */}
            <div
              className={cn(
                'absolute inset-0 flex items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100',
                OVERLAY_SCRIM_CLASS,
              )}
            >
              <span className="type-label-caption text-white">{t('upload.change')}</span>
            </div>
          </div>
        ) : (
          <>
            <CloudUpload className="mb-2 size-8 text-text-muted" />
            <p className="type-body-regular text-text-muted">
              {t('upload.dragDrop')}{' '}
              <span className="type-body-medium text-brand-ink">{t('upload.browse')}</span>
            </p>
            <p className="mt-1 type-label-caption text-text-tertiary">
              {t('upload.hint', { maxSizeMb })}
            </p>
          </>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={maxFiles > 1}
          onChange={handleInputChange}
          className="hidden"
        />
      </div>

      {/* Upload progress */}
      {uploads.length > 0 && (
        <div role="status" aria-live="polite" className="space-y-2">
          {uploadRows}

          {allSettled && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                clearUploads();
              }}
              className={cn('h-auto px-0', CAPTION_CLASS)}
            >
              {t('upload.clear')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
