import { renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRecoveryCodesPanel } from './RecoveryCodesPanel.hooks';

// The component test renders the shell; this suite drives the REAL hook so the
// clipboard + download branches are exercised and covered.
vi.mock('@repo/ui/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const CODES = ['A1B2-C3D4-E5F6-G7H8', 'J9K0-L1M2-N3P4-Q5R6'];

describe('useRecoveryCodesPanel', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('copies the newline-joined codes and flips the copied flag', async () => {
    const { result } = renderHook(() => useRecoveryCodesPanel({ codes: CODES }));
    expect(result.current.copied).toBe(false);

    act(() => result.current.onCopy());

    await waitFor(() => expect(result.current.copied).toBe(true));
    expect(writeText).toHaveBeenCalledWith(CODES.join('\n'));
  });

  it('downloads the codes as a text file', () => {
    const { result } = renderHook(() => useRecoveryCodesPanel({ codes: CODES }));

    // Spy AFTER renderHook so the container element is created normally; only
    // intercept the <a> the hook makes for the download.
    const click = vi.fn();
    const anchor = { href: '', download: '', click } as unknown as HTMLAnchorElement;
    const original = document.createElement.bind(document);
    const createElement = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tag: string) => (tag === 'a' ? anchor : original(tag)));

    act(() => result.current.onDownload());

    expect(anchor.download).toBe('recovery-codes.txt');
    expect(click).toHaveBeenCalledOnce();
    createElement.mockRestore();
  });
});
