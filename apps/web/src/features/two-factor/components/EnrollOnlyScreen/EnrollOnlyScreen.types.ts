export interface IEnrollOnlyScreenView {
  readonly onLogout: () => void;
  readonly isLoggingOut: boolean;
  readonly onEnrollComplete: () => void;
}
