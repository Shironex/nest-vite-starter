import { useCallback, useState } from 'react';
import { toast } from '@repo/ui/sonner';
import { RECOVERY_CODES_FILENAME } from '../../TwoFactor.constants';
import type { IRecoveryCodesPanelProps, IRecoveryCodesPanelView } from './RecoveryCodesPanel.types';
import { twoFactorStrings } from '@/features/two-factor/TwoFactor.strings';

/**
 * Copy + download wiring for the one-time recovery-codes display. Both actions
 * derive from the same newline-joined text so the clipboard and the downloaded
 * file always match what is on screen.
 */
export function useRecoveryCodesPanel({
  codes,
}: IRecoveryCodesPanelProps): IRecoveryCodesPanelView {
  const [copied, setCopied] = useState(false);
  const text = codes.join('\n');

  const onCopy = useCallback(() => {
    void navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        toast.success(twoFactorStrings.recoveryCodes.copiedToast);
      },
      () => toast.error(twoFactorStrings.recoveryCodes.copyFailed),
    );
  }, [text]);

  const onDownload = useCallback(() => {
    const blob = new Blob([`${text}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = RECOVERY_CODES_FILENAME;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [text]);

  return { codes, copied, onCopy, onDownload };
}
