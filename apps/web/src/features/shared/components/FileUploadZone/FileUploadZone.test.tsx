import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IUploadProgress } from './FileUploadZone.types';
import { buildPresignedPostFormData } from './FileUploadZone.hooks';
import FileUploadZone from './FileUploadZone';

const state = vi.hoisted(() => ({
  uploads: [] as IUploadProgress[],
}));

// Stub @/lib/trpc so importing the real hooks module (for the FormData
// helper below) needs no network or Electron bootstrap.
vi.mock('@/lib/trpc', () => ({
  trpc: {
    storage: {
      requestUpload: {
        mutationOptions: () => ({}),
      },
    },
  },
}));

// Stub the hook so component tests are deterministic and offline (no
// mutation, no XHR); keep the real module for the pure FormData helper.
vi.mock('./FileUploadZone.hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./FileUploadZone.hooks')>();
  return {
    ...actual,
    useFileUploadZone: () => ({
      isDragOver: false,
      uploads: state.uploads,
      isUploading: false,
      maxSizeMb: 5,
      inputRef: { current: null },
      handleDrop: vi.fn(),
      handleDragOver: vi.fn(),
      handleDragLeave: vi.fn(),
      handleClick: vi.fn(),
      handleInputChange: vi.fn(),
      clearUploads: vi.fn(),
      allSettled: true,
    }),
  };
});

describe('FileUploadZone', () => {
  const noop = () => {};

  it('renders the dropzone with the browse prompt', () => {
    state.uploads = [];
    render(<FileUploadZone onUploadComplete={noop} />);
    expect(screen.getByText(/click to browse/i)).toBeInTheDocument();
  });

  it('renders separate rows for re-uploads of the same filename (keyed by id)', () => {
    state.uploads = [
      { id: 'a', filename: 'avatar.png', progress: 0, status: 'error', error: 'Upload failed' },
      { id: 'b', filename: 'avatar.png', progress: 50, status: 'uploading' },
    ];
    render(<FileUploadZone onUploadComplete={noop} />);
    expect(screen.getAllByText('avatar.png')).toHaveLength(2);
    expect(screen.getByText('Upload failed')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('shows the max size derived from the hook', () => {
    render(<FileUploadZone onUploadComplete={noop} />);
    expect(screen.getByText(/max 5 MB/i)).toBeInTheDocument();
  });

  it('renders the dropzone as an accessible button', () => {
    render(<FileUploadZone onUploadComplete={noop} />);
    expect(screen.getByRole('button', { name: /upload an image/i })).toBeInTheDocument();
  });

  it('renders the current avatar when currentImageUrl is provided', () => {
    render(
      <FileUploadZone onUploadComplete={noop} currentImageUrl="https://example.com/avatar.png" />,
    );
    expect(screen.getByAltText('Current avatar')).toBeInTheDocument();
  });
});

describe('buildPresignedPostFormData', () => {
  it('appends every policy field before the file and the file LAST under "file"', () => {
    const file = new File(['x'], 'avatar.png', { type: 'image/png' });
    const fields = {
      'Content-Type': 'image/png',
      key: 'avatars/user1/uuid.png',
      Policy: 'base64policy',
      'X-Amz-Signature': 'signature',
    };

    const formData = buildPresignedPostFormData(file, fields);
    const names = [...formData.keys()];

    // S3 ignores fields after the file entry, so the file must close the form.
    expect(names[names.length - 1]).toBe('file');
    expect(names.slice(0, -1)).toEqual(Object.keys(fields));
    expect(formData.get('file')).toBe(file);
    expect(formData.get('Policy')).toBe('base64policy');
  });
});
