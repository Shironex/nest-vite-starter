import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '@repo/ui/sonner';
import { RECOVERY_CODES_FILENAME } from '../../TwoFactor.constants';
import type { IRecoveryCodesPanelProps, IRecoveryCodesPanelView } from './RecoveryCodesPanel.types';

/**
 * Copy + download wiring for the one-time recovery-codes display. Both actions
 * derive from the same newline-joined text so the clipboard and the downloaded
 * file always match what is on screen.
 */
export function useRecoveryCodesPanel({
  codes,
}: IRecoveryCodesPanelProps): IRecoveryCodesPanelView {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const text = codes.join('\n');

  const onCopy = useCallback(() => {
    void navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        toast.success(t('twoFactor.recoveryCodes.copiedToast'));
      },
      () => toast.error(t('twoFactor.recoveryCodes.copyFailed')),
    );
  }, [text, t]);

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
