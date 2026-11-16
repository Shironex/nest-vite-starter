export interface IRecoveryCodesPanelProps {
  /** The one-time recovery codes to display; the server reveals them exactly once. */
  readonly codes: readonly string[];
}

export interface IRecoveryCodesPanelView {
  readonly codes: readonly string[];
  readonly copied: boolean;
  readonly onCopy: () => void;
  readonly onDownload: () => void;
}
