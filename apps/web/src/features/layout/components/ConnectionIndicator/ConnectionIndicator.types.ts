import type { ConnectionStatus } from '@/stores/socket-store';

export interface IConnectionIndicatorView {
  readonly status: ConnectionStatus;
  readonly label: string;
  readonly color: string;
}
