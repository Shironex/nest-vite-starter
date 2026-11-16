import { Download, Loader2 } from 'lucide-react';
import { Button } from '@repo/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/card';
import { useDataExportSection } from './DataExportSection.hooks';
import { settingsStrings } from '@/features/settings/Settings.strings';

/**
 * The GDPR account-export panel: says what the export contains, then
 * downloads it as a JSON file via `dataExport.download`.
 */
export default function DataExportSection() {
  const { onDownload, isPending, errorMessage } = useDataExportSection();

  const buttonIcon = isPending ? (
    <Loader2 aria-hidden="true" className="animate-spin" />
  ) : (
    <Download aria-hidden="true" />
  );
  const errorLine = errorMessage ? (
    <p role="alert" className="type-body-small text-danger">
      {errorMessage}
    </p>
  ) : null;

  return (
    <Card data-slot="data-export-section">
      <CardHeader>
        <CardTitle>{settingsStrings.dataExport.title}</CardTitle>
        <CardDescription>{settingsStrings.dataExport.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="type-body-small text-text-muted">{settingsStrings.dataExport.contents}</p>
        <Button onClick={onDownload} disabled={isPending}>
          {buttonIcon}
          {settingsStrings.dataExport.download}
        </Button>
        {errorLine}
      </CardContent>
    </Card>
  );
}
