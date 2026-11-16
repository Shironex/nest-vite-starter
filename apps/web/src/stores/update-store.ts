import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { UPDATE_CHANNELS } from '@repo/shared/desktop';
import type { UpdateChannel, UpdateStatusPayload } from '@repo/shared/desktop';
import { toast } from '@repo/ui/sonner';
import { i18n } from '@/lib/i18n';
import { IS_ELECTRON } from '@/lib/electron';

/** Every IPC status the main process emits, plus the renderer-only 'idle'. */
type UpdateStatus = UpdateStatusPayload['status'] | 'idle';

interface IUpdateState {
  status: UpdateStatus;
  version: string | null;
  releaseNotes: string | null;
  progress: { percent: number; transferred: number; total: number } | null;
  error: string | null;
  channel: UpdateChannel;
  dismissed: boolean;
}

interface IUpdateActions {
  setStatus: (payload: UpdateStatusPayload) => void;
  /** Sync-from-main setter. Does not write back over IPC. */
  setChannel: (channel: UpdateChannel) => void;
  /**
   * User-initiated channel change: sets the store optimistically, persists via
   * IPC, and rolls back (with a toast) when the main-process write fails so the
   * UI never diverges from the main process.
   */
  selectChannel: (channel: UpdateChannel) => void;
  dismiss: () => void;
  undismiss: () => void;
}

type UpdateStore = IUpdateState & IUpdateActions;

export const useUpdateStore = create<UpdateStore>()(
  devtools(
    (set, get) => ({
      status: 'idle',
      version: null,
      releaseNotes: null,
      progress: null,
      error: null,
      channel: 'stable',
      dismissed: false,

      setStatus: (payload) =>
        set(
          (state) => ({
            status: payload.status,
            version: payload.version ?? null,
            releaseNotes: payload.releaseNotes ?? null,
            progress: payload.progress ?? null,
            error: payload.error ?? null,
            // Un-dismiss when a new downloaded state arrives; keep current dismissed otherwise
            dismissed: payload.status === 'downloaded' ? false : state.dismissed,
          }),
          undefined,
          'update/setStatus',
        ),

      setChannel: (channel) => set({ channel }, undefined, 'update/setChannel'),

      selectChannel: (channel) => {
        const previous = get().channel;
        if (previous === channel) return;

        set({ channel }, undefined, 'update/selectChannel');

        const api = window.electronAPI;
        if (!api) return;

        api.updater.setChannel(channel).catch((error: unknown) => {
          console.error('[updater] failed to persist channel change', error);
          set({ channel: previous }, undefined, 'update/selectChannelRollback');
          toast.error(i18n.t('common:desktop.channelChangeFailed'), {
            description: i18n.t('common:desktop.channelChangeFailedDescription', {
              channel: i18n.t(`common:settings.updates.channels.${previous}`),
            }),
          });
        });
      },

      dismiss: () => set({ dismissed: true }, undefined, 'update/dismiss'),

      undismiss: () => set({ dismissed: false }, undefined, 'update/undismiss'),
    }),
    { name: 'update' },
  ),
);

/**
 * Initialize the update store IPC listener.
 * Call once at app startup. No-op in web mode.
 */
export function initUpdateListener(): void {
  if (!IS_ELECTRON) return;

  // Load initial channel from main process
  window
    .electronAPI!.updater.getChannel()
    .then((channel) => {
      if ((UPDATE_CHANNELS as readonly string[]).includes(channel)) {
        useUpdateStore.getState().setChannel(channel);
      }
    })
    .catch((error: unknown) => {
      // Keep the 'stable' default; the settings screen still works.
      console.error('[updater] failed to read update channel', error);
    });

  // Subscribe to updater status events from main process
  window.electronAPI!.updater.onUpdateStatus((payload) => {
    useUpdateStore.getState().setStatus(payload);
  });
}
