// The ESLint config is plain JS; the parity test reads only this one export.
declare module '@repo/eslint-config/nestjs' {
  export const LOG_DENY_NAMES: readonly string[];
}
