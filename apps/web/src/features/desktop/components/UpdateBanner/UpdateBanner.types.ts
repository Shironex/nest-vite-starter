export interface IUpdateBannerView {
  readonly status: 'available' | 'downloading' | 'downloaded' | 'error';
  readonly versionLabel: string;
  readonly progressLabel: string;
  readonly errorLabel: string;
  /** Explicit user action: downloads are never started automatically (unsigned builds). */
  readonly onDownload: () => void;
  readonly onRestart: () => void;
  readonly onDismiss: () => void;
}
