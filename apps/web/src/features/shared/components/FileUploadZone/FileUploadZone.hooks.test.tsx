import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import enLocale from '@/lib/i18n/locales/en.json';
import type { IFileUploadZoneProps } from './FileUploadZone.types';
import { useFileUploadZone } from './FileUploadZone.hooks';

// The component test (FileUploadZone.test.tsx) mocks this hook to render an
// offline shell. This suite does the opposite: it drives the REAL hook through
// renderHook so the presigned-POST upload flow (mutation + XHR + drag/drop
// handlers) is actually exercised and covered.

const { requestUploadFn } = vi.hoisted(() => ({ requestUploadFn: vi.fn() }));

// Stub @/lib/trpc so useMutation gets a plain mutationFn: no Electron
// bootstrap, no network. The hook only reads storage.requestUpload.
vi.mock('@/lib/trpc', () => ({
  trpc: {
    storage: {
      requestUpload: { mutationOptions: () => ({ mutationFn: requestUploadFn }) },
    },
  },
}));

const UPLOAD_RESULT = {
  url: 'https://s3.example.com/bucket',
  fields: { key: 'avatars/u/uuid.png', Policy: 'p', 'X-Amz-Signature': 's' },
  key: 'avatars/u/uuid.png',
  downloadUrl: 'https://cdn.example.com/avatars/u/uuid.png',
};

type XhrBehavior = 'success' | 'http-error' | 'network-error';
let xhrBehavior: XhrBehavior = 'success';

// Minimal XHR fake: fires one progress event, then resolves onload with a
// configurable status (or onerror for a transport failure).
class FakeXHR {
  status = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  upload: {
    onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;
  } = { onprogress: null };
  open = vi.fn();
  send = vi.fn(() => {
    this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
    queueMicrotask(() => {
      if (xhrBehavior === 'network-error') {
        this.onerror?.();
        return;
      }
      this.status = xhrBehavior === 'http-error' ? 500 : 204;
      this.onload?.();
    });
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function setup(props: Partial<IFileUploadZoneProps> = {}) {
  const onUploadComplete = vi.fn();
  const onUploadError = vi.fn();
  const utils = renderHook(() => useFileUploadZone({ onUploadComplete, onUploadError, ...props }), {
    wrapper,
  });
  return { ...utils, onUploadComplete, onUploadError };
}

function imageFile(name = 'avatar.png', bytes = 1) {
  return new File([new Uint8Array(bytes)], name, { type: 'image/png' });
}

// The view exposes file handling through the input's onChange, not a raw
// handleFiles. Drive uploads the way the component does.
async function pickFiles(
  result: { current: { handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void } },
  files: File[],
) {
  await act(async () => {
    result.current.handleInputChange({
      target: { files, value: '' },
    } as unknown as React.ChangeEvent<HTMLInputElement>);
  });
}

beforeEach(() => {
  xhrBehavior = 'success';
  requestUploadFn.mockReset();
  requestUploadFn.mockResolvedValue(UPLOAD_RESULT);
  vi.stubGlobal('XMLHttpRequest', FakeXHR);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useFileUploadZone', () => {
  it('derives maxSizeMb from maxSize', () => {
    const { result } = setup({ maxSize: 3 * 1024 * 1024 });
    expect(result.current.maxSizeMb).toBe(3);
  });

  it('uploads a valid file: requests a policy, POSTs it, and reports completion', async () => {
    const { result, onUploadComplete, onUploadError } = setup();

    await pickFiles(result, [imageFile()]);

    await waitFor(() =>
      expect(onUploadComplete).toHaveBeenCalledWith(UPLOAD_RESULT.key, UPLOAD_RESULT.downloadUrl),
    );
    expect(requestUploadFn).toHaveBeenCalledTimes(1);
    expect(onUploadError).not.toHaveBeenCalled();
    expect(result.current.uploads[0]).toMatchObject({ status: 'complete', progress: 100 });
    expect(result.current.allSettled).toBe(true);
  });

  it('rejects an unsupported file type before any upload request', async () => {
    const { result, onUploadError } = setup();
    const txt = new File(['x'], 'notes.txt', { type: 'text/plain' });

    await pickFiles(result, [txt]);

    expect(requestUploadFn).not.toHaveBeenCalled();
    expect(onUploadError).toHaveBeenCalledWith(expect.stringMatching(/is not a supported image/i));
    expect(result.current.uploads[0]?.status).toBe('error');
  });

  it('rejects a file that exceeds maxSize', async () => {
    const { result, onUploadError } = setup({ maxSize: 5 });

    await pickFiles(result, [imageFile('big.png', 10)]);

    expect(requestUploadFn).not.toHaveBeenCalled();
    expect(onUploadError).toHaveBeenCalledWith(expect.stringMatching(/exceeds the/i));
  });

  it('marks the upload as errored when storage returns a non-2xx status', async () => {
    xhrBehavior = 'http-error';
    const { result, onUploadComplete, onUploadError } = setup();

    await pickFiles(result, [imageFile()]);

    await waitFor(() => expect(onUploadError).toHaveBeenCalled());
    expect(onUploadComplete).not.toHaveBeenCalled();
    expect(result.current.uploads[0]?.status).toBe('error');
  });

  it('reports the translated appCode when the request-policy mutation rejects', async () => {
    requestUploadFn.mockRejectedValueOnce({
      message: 'Too many requests',
      data: { code: 'TOO_MANY_REQUESTS', httpStatus: 429, appCode: 'RATE_LIMITED' },
    });
    const { result, onUploadError } = setup();

    await pickFiles(result, [imageFile()]);

    await waitFor(() => expect(onUploadError).toHaveBeenCalledWith(enLocale.errors.RATE_LIMITED));
    expect(result.current.uploads[0]?.status).toBe('error');
  });

  // The upload row used to render whatever the exception said, which on this
  // path is an api or browser internal rather than user copy.
  it('falls back to the panel copy for an untranslatable failure', async () => {
    requestUploadFn.mockRejectedValueOnce(new Error('quota exceeded'));
    const { result, onUploadError } = setup();

    await pickFiles(result, [imageFile()]);

    await waitFor(() => expect(onUploadError).toHaveBeenCalled());
    expect(onUploadError).not.toHaveBeenCalledWith('quota exceeded');
    expect(result.current.uploads[0]?.status).toBe('error');
    expect(result.current.uploads[0]?.error).toBe(enLocale.common.upload.failed);
  });

  it('deduplicates a second pick of the same in-flight filename', async () => {
    const { result } = setup({ maxFiles: 3 });

    await pickFiles(result, [imageFile('a.png'), imageFile('a.png')]);

    await waitFor(() => expect(requestUploadFn).toHaveBeenCalledTimes(1));
  });

  it('respects maxFiles by only taking the first N files', async () => {
    const { result } = setup({ maxFiles: 1 });

    await pickFiles(result, [imageFile('a.png'), imageFile('b.png')]);

    await waitFor(() => expect(requestUploadFn).toHaveBeenCalledTimes(1));
  });

  it('toggles isDragOver on drag over and leave', () => {
    const { result } = setup();
    const evt = {
      preventDefault: vi.fn(),
      dataTransfer: { files: [] },
    } as unknown as React.DragEvent;

    act(() => result.current.handleDragOver(evt));
    expect(result.current.isDragOver).toBe(true);

    act(() => result.current.handleDragLeave(evt));
    expect(result.current.isDragOver).toBe(false);
  });

  it('handles a drop by clearing drag state and processing the files', async () => {
    const { result, onUploadComplete } = setup();
    const preventDefault = vi.fn();
    const evt = {
      preventDefault,
      dataTransfer: { files: [imageFile()] },
    } as unknown as React.DragEvent;

    await act(async () => {
      result.current.handleDrop(evt);
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(result.current.isDragOver).toBe(false);
    await waitFor(() => expect(onUploadComplete).toHaveBeenCalled());
  });

  it('opens the native file picker on click', () => {
    const { result } = setup();
    const click = vi.fn();

    act(() => {
      (result.current.inputRef as { current: unknown }).current = { click };
      result.current.handleClick();
    });

    expect(click).toHaveBeenCalled();
  });

  it('processes files from the input change and resets the input value', async () => {
    const { result, onUploadComplete } = setup();
    const target = { files: [imageFile()], value: 'C:/fakepath/avatar.png' };

    await act(async () => {
      result.current.handleInputChange({
        target,
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(target.value).toBe('');
    await waitFor(() => expect(onUploadComplete).toHaveBeenCalled());
  });

  it('clears the upload list', async () => {
    const { result } = setup();
    const txt = new File(['x'], 'notes.txt', { type: 'text/plain' });

    await pickFiles(result, [txt]);
    expect(result.current.uploads.length).toBeGreaterThan(0);

    act(() => result.current.clearUploads());
    expect(result.current.uploads).toHaveLength(0);
  });
});
