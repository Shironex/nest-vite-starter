'use client';

import * as React from 'react';
import { useDropzone } from 'react-dropzone';
import { XIcon, UploadIcon, FileIcon } from 'lucide-react';

import { cn } from '@repo/ui/lib/utils';
import { Button } from './button';

interface IFile {
  file: globalThis.File;
  preview: string;
  progress?: number;
}

interface IDropzoneProps {
  onFilesSelected?: (files: globalThis.File[]) => void;
  maxFiles?: number;
  maxSize?: number;
  accept?: Record<string, string[]>;
  disabled?: boolean;
  className?: string;
}

interface IDropzoneContentProps {
  isDragActive: boolean;
  isDragAccept: boolean;
  isDragReject: boolean;
  className?: string;
}

interface IFileListProps {
  files: IFile[];
  onRemove?: (index: number) => void;
  showProgress?: boolean;
  className?: string;
}

interface IFileListItemProps {
  file: IFile;
  onRemove?: () => void;
  showProgress?: boolean;
}

function Dropzone({
  onFilesSelected,
  maxFiles = 10,
  maxSize = 10 * 1024 * 1024, // 10MB
  accept,
  disabled = false,
  className,
}: IDropzoneProps) {
  const { getRootProps, getInputProps, isDragActive, isDragAccept, isDragReject } = useDropzone({
    onDrop: (acceptedFiles: globalThis.File[]) => {
      onFilesSelected?.(acceptedFiles);
    },
    maxFiles,
    maxSize,
    ...(accept ? { accept } : {}),
    disabled,
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        'cursor-pointer rounded-lg border-2 border-dashed border-muted-foreground/25 transition-colors',
        isDragActive && 'border-primary/50 bg-primary/5',
        isDragReject && 'border-destructive/50 bg-destructive/5',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <input {...getInputProps()} />
      <DropzoneContent
        isDragActive={isDragActive}
        isDragAccept={isDragAccept}
        isDragReject={isDragReject}
      />
    </div>
  );
}

function DropzoneContent({
  isDragActive,
  isDragAccept,
  isDragReject,
  className,
}: IDropzoneContentProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-12', className)}>
      <div
        className={cn(
          'rounded-lg p-3 transition-colors',
          isDragActive && isDragAccept && 'bg-primary/10',
          isDragReject && 'bg-destructive/10',
        )}
      >
        <UploadIcon
          className={cn(
            'h-8 w-8 transition-colors',
            isDragReject ? 'text-destructive' : 'text-muted-foreground',
          )}
        />
      </div>
      <div className="text-center">
        <p className="font-medium">
          {isDragActive
            ? isDragReject
              ? 'Invalid file type'
              : 'Drop files here'
            : 'Drag files here or click to select'}
        </p>
        <p className="text-sm text-muted-foreground">
          You can upload up to 10 files, max 10MB each
        </p>
      </div>
    </div>
  );
}

function FileList({ files, onRemove, showProgress = false, className }: IFileListProps) {
  if (files.length === 0) {
    return null;
  }

  return (
    <div className={cn('mt-4 space-y-2', className)}>
      {files.map((file, index) => (
        <FileListItem
          key={`${file.file.name}-${index}`}
          file={file}
          onRemove={() => onRemove?.(index)}
          showProgress={showProgress}
        />
      ))}
    </div>
  );
}

function FileListItem({ file, onRemove, showProgress = false }: IFileListItemProps) {
  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border border-input bg-muted/30 p-3">
      <FileIcon className="h-4 w-4 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{file.file.name}</p>
        <p className="text-xs text-muted-foreground">
          {file.file.type} • {formatSize(file.file.size)}
        </p>
        {showProgress && file.progress !== undefined && (
          <div
            role="progressbar"
            aria-valuenow={Math.round(file.progress)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Upload progress for ${file.file.name}`}
            className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${file.progress}%` }}
            />
          </div>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onRemove}
        aria-label={`Remove ${file.file.name}`}
        className="h-6 w-6"
      >
        <XIcon className="h-4 w-4" />
      </Button>
    </div>
  );
}

export { Dropzone, DropzoneContent, FileList, FileListItem };
