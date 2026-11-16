export interface ITitleBarView {
  readonly isMaximized: boolean;
  readonly isAuthenticated: boolean;
  readonly isLoading: boolean;
  readonly onMinimize: () => void;
  readonly onMaximize: () => void;
  readonly onClose: () => void;
}
