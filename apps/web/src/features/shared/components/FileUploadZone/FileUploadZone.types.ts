export interface IUploadProgress {
  /**
   * Unique per upload attempt (crypto.randomUUID), so re-uploading the same
   * filename after a failure never collides with the old row.
   */
  readonly id: string;
  readonly filename: string;
  readonly progress: number; // 0-100
  readonly status: 'uploading' | 'complete' | 'error';
  readonly error?: string;
}

export interface IFileUploadZoneProps {
  readonly onUploadComplete: (key: string, url: string) => void;
  readonly onUploadError?: (error: string) => void;
  readonly accept?: string;
  readonly maxSize?: number;
  readonly maxFiles?: number;
  readonly currentImageUrl?: string;
  readonly className?: string;
}

export interface IFileUploadZoneView {
  readonly isDragOver: boolean;
  readonly uploads: readonly IUploadProgress[];
  readonly isUploading: boolean;
  readonly maxSizeMb: number;
  readonly inputRef: React.RefObject<HTMLInputElement | null>;
  readonly handleDrop: (e: React.DragEvent) => void;
  readonly handleDragOver: (e: React.DragEvent) => void;
  readonly handleDragLeave: (e: React.DragEvent) => void;
  readonly handleClick: () => void;
  readonly handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  readonly clearUploads: () => void;
  readonly allSettled: boolean;
}
