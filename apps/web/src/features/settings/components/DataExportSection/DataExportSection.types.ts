export interface IDataExportSectionView {
  readonly onDownload: () => void;
  readonly isPending: boolean;
  readonly errorMessage: string | undefined;
}
