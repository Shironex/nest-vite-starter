import { Check, Copy, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@repo/ui/button';
import { useRecoveryCodesPanel } from './RecoveryCodesPanel.hooks';
import type { IRecoveryCodesPanelProps } from './RecoveryCodesPanel.types';

export default function RecoveryCodesPanel(props: IRecoveryCodesPanelProps) {
  const { t } = useTranslation();
  const { codes, copied, onCopy, onDownload } = useRecoveryCodesPanel(props);

  const codeItems = codes.map((code) => (
    <li
      key={code}
      className="rounded-md bg-subtle px-3 py-2 text-center type-mono-small tracking-widest text-text"
    >
      {code}
    </li>
  ));
  const copyIcon = copied ? <Check className="size-4" /> : <Copy className="size-4" />;
  const copyLabel = copied
    ? t('twoFactor.recoveryCodes.copied')
    : t('twoFactor.recoveryCodes.copy');

  return (
    <div className="flex flex-col gap-4" data-slot="recovery-codes-panel">
      <ul className="grid grid-cols-2 gap-2">{codeItems}</ul>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCopy}>
          {copyIcon}
          {copyLabel}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onDownload}>
          <Download className="size-4" />
          {t('twoFactor.recoveryCodes.download')}
        </Button>
      </div>
    </div>
  );
}
