import type { UpdateChannel, UpdateStatusPayload } from '@repo/shared/desktop';

export interface IUpdatesSectionView {
  readonly status: UpdateStatusPayload['status'] | 'idle';
  /** null while loading (skeleton); 'Unknown' when the IPC failed or returned nothing. */
  readonly appVersion: string | null;
  /** Formatted label for the available/downloaded update version, e.g. "v1.2.3" or "". */
  readonly updateVersionLabel: string;
  readonly channel: UpdateChannel;
  readonly handleCheckForUpdates: () => void;
  /** Explicit user action: downloads are never started automatically (unsigned builds). */
  readonly handleDownloadUpdate: () => void;
  readonly handleChannelChange: (newChannel: UpdateChannel) => void;
  readonly handleInstallUpdate: () => void;
}
