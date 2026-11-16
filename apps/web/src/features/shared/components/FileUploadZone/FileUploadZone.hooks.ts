import { useCallback, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ALLOWED_IMAGE_TYPES, type AllowedImageType } from '@repo/shared/schemas';
import { MAX_FILE_SIZE } from '@repo/shared/constants';
import { trpc } from '@/lib/trpc';
import { translateAppError } from '@/lib/trpc-errors';
import type {
  IFileUploadZoneProps,
  IFileUploadZoneView,
  IUploadProgress,
} from './FileUploadZone.types';

/**
 * Build the multipart body for an S3 presigned POST upload. S3 evaluates the
 * policy against the fields that arrive BEFORE the file and ignores anything
 * after it, so every policy field is appended first and the file goes last
 * under the canonical `file` field name.
 */
export function buildPresignedPostFormData(file: File, fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    formData.append(name, value);
  }
  formData.append('file', file);
  return formData;
}

export function useFileUploadZone({
  onUploadComplete,
  onUploadError,
  maxSize = MAX_FILE_SIZE,
  maxFiles = 1,
}: {
  onUploadComplete: IFileUploadZoneProps['onUploadComplete'];
  onUploadError?: IFileUploadZoneProps['onUploadError'];
  maxSize?: IFileUploadZoneProps['maxSize'];
  maxFiles?: IFileUploadZoneProps['maxFiles'];
}): IFileUploadZoneView {
  const { t } = useTranslation();
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploads, setUploads] = useState<IUploadProgress[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  // Names currently being uploaded, so a fast re-pick of the same file can't
  // fire a second presigned-upload request for one logical upload.
  const inFlightRef = useRef<Set<string>>(new Set());

  const requestUploadMutation = useMutation(trpc.storage.requestUpload.mutationOptions());

  const maxSizeMb = maxSize / 1024 / 1024;

  const validateFile = useCallback(
    (file: File): string | null => {
      if (!(file.type in ALLOWED_IMAGE_TYPES)) {
        return t('upload.unsupportedType', { filename: file.name });
      }
      if (file.size > maxSize) {
        return t('upload.tooLarge', { filename: file.name, maxSizeMb });
      }
      return null;
    },
    [maxSize, maxSizeMb, t],
  );

  const uploadViaPresignedPost = useCallback(
    (
      uploadId: string,
      file: File,
      url: string,
      fields: Record<string, string>,
    ): Promise<boolean> => {
      return new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        // No Content-Type header here: the browser must set the multipart
        // boundary itself. The file's Content-Type travels as a policy field.

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const pct = Math.round((event.loaded / event.total) * 100);
            setUploads((prev) =>
              prev.map((u) => (u.id === uploadId ? { ...u, progress: pct } : u)),
            );
          }
        };

        xhr.onload = () => {
          // S3 answers a POST policy upload with 201 or 204 depending on
          // success_action_status, so accept any 2xx.
          resolve(xhr.status >= 200 && xhr.status < 300);
        };

        xhr.onerror = () => resolve(false);

        xhr.send(buildPresignedPostFormData(file, fields));
      });
    },
    [],
  );

  /** Mark one row failed and hand the same sentence to the parent. */
  const failUpload = useCallback(
    (uploadId: string, message: string) => {
      setUploads((prev) =>
        prev.map((u) => (u.id === uploadId ? { ...u, status: 'error', error: message } : u)),
      );
      onUploadError?.(message);
    },
    [onUploadError],
  );

  const uploadFile = useCallback(
    async (file: File) => {
      // Unique per attempt: re-uploading the same filename after a failure
      // must never collide with (or corrupt) the old row.
      const uploadId = crypto.randomUUID();
      inFlightRef.current.add(file.name);
      setUploads((prev) => [
        ...prev,
        { id: uploadId, filename: file.name, progress: 0, status: 'uploading' },
      ]);

      try {
        // 1. Request a presigned POST policy. contentType is safe to narrow
        // here: the file was already checked against ALLOWED_IMAGE_TYPES in
        // validateFile.
        const { url, fields, key, downloadUrl } = await requestUploadMutation.mutateAsync({
          filename: file.name,
          contentType: file.type as AllowedImageType,
          size: file.size,
        });

        // 2. POST the file with the policy fields directly to storage
        const posted = await uploadViaPresignedPost(uploadId, file, url, fields);
        if (!posted) {
          // Reported directly rather than thrown: the copy for this branch is
          // already known and translated, and routing it through the catch would
          // make it indistinguishable from a real exception on a path that no
          // longer trusts `error.message`.
          failUpload(uploadId, t('upload.postFailed'));
          return;
        }

        setUploads((prev) =>
          prev.map((u) => (u.id === uploadId ? { ...u, progress: 100, status: 'complete' } : u)),
        );
        onUploadComplete(key, downloadUrl);
      } catch (err) {
        // The presign call is a tRPC mutation, so a real appCode is available
        // here; a transport failure gets the network sentence. `err.message`
        // on this path is an api/browser internal, never user copy.
        failUpload(uploadId, translateAppError(err) ?? t('upload.failed'));
      } finally {
        inFlightRef.current.delete(file.name);
      }
    },
    [requestUploadMutation, uploadViaPresignedPost, onUploadComplete, failUpload, t],
  );

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files).slice(0, maxFiles);

      for (const file of fileArray) {
        // Skip files already being uploaded (fast re-pick / double-drop).
        if (inFlightRef.current.has(file.name)) {
          continue;
        }
        const error = validateFile(file);
        if (error) {
          onUploadError?.(error);
          setUploads((prev) => [
            ...prev,
            { id: crypto.randomUUID(), filename: file.name, progress: 0, status: 'error', error },
          ]);
          continue;
        }
        uploadFile(file);
      }
    },
    [maxFiles, validateFile, uploadFile, onUploadError],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        handleFiles(e.target.files);
      }
      // Reset input so the same file can be re-selected
      e.target.value = '';
    },
    [handleFiles],
  );

  const clearUploads = useCallback(() => {
    setUploads([]);
  }, []);

  const isUploading = uploads.some((u) => u.status === 'uploading');
  const allSettled = uploads.every((u) => u.status !== 'uploading');

  return {
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
  };
}
