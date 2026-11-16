import { useTranslation } from 'react-i18next';
import { useSocketStore, type ConnectionStatus } from '@/stores/socket-store';
import type { IConnectionIndicatorView } from './ConnectionIndicator.types';

/**
 * `motion-reduce:animate-none` on the two pulsing states: every other motion
 * string in the app ends that way (see @repo/ui/animations), and a dot that
 * pulses forever is exactly the kind of continuous motion the preference asks
 * to stop.
 */
const STATUS_CONFIG: Record<ConnectionStatus, { labelKey: string; color: string }> = {
  connected: { color: 'bg-green-500', labelKey: 'connection.connected' },
  connecting: {
    color: 'bg-amber-500 animate-pulse motion-reduce:animate-none',
    labelKey: 'connection.connecting',
  },
  reconnecting: {
    color: 'bg-amber-500 animate-pulse motion-reduce:animate-none',
    labelKey: 'connection.reconnecting',
  },
  disconnected: { color: 'bg-gray-400', labelKey: 'connection.disconnected' },
};

export function useConnectionIndicator(): IConnectionIndicatorView {
  const { t } = useTranslation();
  const status = useSocketStore((s) => s.status);
  const { labelKey, color } = STATUS_CONFIG[status];
  return { status, label: t(labelKey), color };
}
