import type { AppErrorCode } from '@repo/shared/errors';

/**
 * Look a label up in a copy table by a runtime key, falling back to the key
 * itself (or `fallback`) so a value the table has not learned yet still renders as readable text.
 */
export function labelFor(
  table: Readonly<Record<string, string>>,
  key: string,
  fallback: string = key,
): string {
  return Object.hasOwn(table, key) ? (table[key] as string) : fallback;
}

/**
 * Shared English copy: strings used by more than one feature, or outside any
 * feature (app shell, route titles, fallbacks). Plain `as const` data; entries
 * with interpolated values are small functions. Feature copy lives in each
 * feature's `*.strings.ts`.
 */
export const commonStrings = {
  actions: {
    save: 'Save',
    cancel: 'Cancel',
    confirm: 'Confirm',
    delete: 'Delete',
    edit: 'Edit',
    close: 'Close',
    back: 'Back',
    search: 'Search',
    retry: 'Try again',
  },
  states: {
    loading: 'Loading...',
  },
  list: {
    filters: 'Filters',
    filtersHeading: 'Narrow the list',
    filtersActive: (count: number) =>
      count === 1 ? `${count} active filter` : `${count} active filters`,
  },
  pagination: {
    previous: 'Previous',
    next: 'Next',
  },
  errors: {
    unexpected: 'An unexpected error occurred',
    refreshFailed: 'Failed to refresh data',
    network: 'No connection to the server. Check your internet and try again.',
  },
  fallback: {
    errorTitle: 'Something went wrong',
    rootErrorDescription: 'The application encountered an error.',
    reload: 'Reload page',
    notFoundTitle: 'Page not found',
    notFoundDescription: 'The page you are looking for does not exist.',
    goToDashboard: 'Go to the dashboard',
    skipToContent: 'Skip to main content',
  },
  uiLabels: {
    toggleSidebar: 'Toggle sidebar',
    sidebarTitle: 'Sidebar',
    sidebarDescription: 'Displays the mobile sidebar.',
    notifications: 'Notifications',
  },
  dateField: {
    openCalendar: 'Open calendar',
    previousMonth: 'Previous month',
    nextMonth: 'Next month',
    formatHint: ({ pattern }: { pattern: string }) =>
      `Format ${pattern}. Type the date, or press Alt and the down arrow to open the calendar.`,
  },
  passwordStrength: {
    met: 'Requirement met:',
    notMet: 'Requirement not met:',
    requirements: {
      minLength: 'At least 8 characters',
      uppercase: 'Uppercase letter',
      lowercase: 'Lowercase letter',
      number: 'Number',
      special: 'Special character',
    },
  },
  pageTitle: {
    signIn: 'Sign in',
    register: 'Create an account',
    forgotPassword: 'Password recovery',
    resetPassword: 'Set a new password',
    verifyEmail: 'Verify email address',
    confirmEmailChange: 'Change email address',
    twoFactor: 'Two-factor verification',
    dashboard: 'Dashboard',
    admin: 'Admin',
    settings: 'Settings',
  },
} as const;

/**
 * One user-facing sentence per `AppErrorCode` the API can put on
 * `error.data.appCode`. `satisfies` makes a missing or misspelled code a
 * compile error.
 */
export const errorStrings = {
  VALIDATION_ERROR: 'Some of the details are invalid. Fix the form and try again.',
  NOT_FOUND: 'We could not find what you were looking for.',
  ALREADY_EXISTS: 'That entry already exists.',
  RATE_LIMITED: 'Too many attempts. Wait a moment and try again.',
  UNAUTHORIZED: 'Sign in to perform this action.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  INTERNAL_ERROR: 'Something went wrong on our side. Please try again shortly.',
  CONFLICT: 'The data changed in the meantime. Reload the view and try again.',
  PAYLOAD_TOO_LARGE: 'The data you are sending is too large. Reduce its size and try again.',
  ACCOUNT_LOCKED: 'This account is temporarily locked after too many failed sign-in attempts.',
  INVALID_CREDENTIALS: 'Incorrect email or password.',
  EMAIL_NOT_VERIFIED: 'Confirm your email address before signing in.',
  INVALID_TOKEN: 'This link is invalid or has already been used.',
  TOKEN_EXPIRED: 'This link has expired. Request a new one.',
  DISPOSABLE_EMAIL: 'Disposable email addresses are not supported. Use a permanent address.',
  TURNSTILE_FAILED: 'The security check failed. Reload the page and try again.',
  CSRF_FAILED: 'Your session expired mid-request. Reload the page and try again.',
  SESSION_EXPIRED: 'Your session has expired. Please sign in again.',
  EMAIL_IN_USE: 'That email address is already taken.',
  PASSWORD_NOT_SET:
    'This account does not have a password set. Set one via password reset to continue.',
  TWO_FACTOR_INVALID_CODE: 'That two-factor code is not valid.',
  TWO_FACTOR_CHALLENGE_EXPIRED: 'The two-factor challenge expired. Start signing in again.',
} satisfies Record<AppErrorCode, string>;
