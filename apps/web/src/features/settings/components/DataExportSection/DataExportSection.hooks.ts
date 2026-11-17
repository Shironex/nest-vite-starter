import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@repo/ui/sonner';
import { PRODUCT_SLUG } from '@repo/shared/constants';
import type { UserDataExport } from '@repo/shared/schemas';
import { trpc } from '@/lib/trpc';
import { translateAppError } from '@/lib/trpc-errors';
import type { IDataExportSectionView } from './DataExportSection.types';
import { settingsStrings } from '@/features/settings/Settings.strings';

/**
 * Filename stem for the downloaded file; the export's own `exportedAt` date is
 * appended so exports taken on different days do not shadow each other on
 * disk. Deliberately not localized, matching `recovery-codes.txt`.
 */
const EXPORT_FILENAME_PREFIX = `${PRODUCT_SLUG}-account-export-`;

/**
 * Turn the export payload into a saved `.json` file, the same anchor-click
 * pattern as `useRecoveryCodesPanel`. `JSON.stringify` renders the
 * superjson-revived `exportedAt` Date as an ISO string in the file.
 */
function saveExportFile(data: UserDataExport): void {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${EXPORT_FILENAME_PREFIX}${data.exportedAt.toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Download wiring for the GDPR account export (`dataExport.download`).
 *
 * A mutation around `fetchQuery` rather than `useQuery`: the export is an
 * on-demand action, not screen state, and every click must reach the server so
 * each downloaded file carries a fresh snapshot and its own audit event
 * (`data_export.downloaded`). `staleTime: 0` forces that fetch and `gcTime: 0`
 * keeps the personal-data payload out of the shared query cache afterwards.
 */
export function useDataExportSection(): IDataExportSectionView {
  const queryClient = useQueryClient();

  const downloadMutation = useMutation({
    mutationFn: (): Promise<UserDataExport> =>
      queryClient.fetchQuery({
        ...trpc.dataExport.download.queryOptions(),
        staleTime: 0,
        gcTime: 0,
      }),
    onSuccess: (data) => {
      saveExportFile(data);
      toast.success(settingsStrings.dataExport.success);
    },
  });

  // RATE_LIMITED (5 exports per hour, enforced in DataExportService) arrives
  // with an appCode and maps it through `errorStrings`; anything else falls
  // back to this section's own generic line. Rendered inline, not toasted: the
  // button the user just pressed is right below it.
  const errorMessage = downloadMutation.isError
    ? (translateAppError(downloadMutation.error) ?? settingsStrings.dataExport.error)
    : undefined;

  return {
    onDownload: () => downloadMutation.mutate(),
    isPending: downloadMutation.isPending,
    errorMessage,
  };
}
