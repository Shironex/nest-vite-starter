export const AppErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  RATE_LIMITED: 'RATE_LIMITED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  // The write lost a race: the row was changed between the read the caller
  // based its request on and the write itself (optimistic-version CAS loser),
  // or the aggregate has already moved past the state the request assumed.
  // Distinct from ALREADY_EXISTS, which is reserved for a genuine duplicate of
  // something the caller is trying to create (an email, a name). The
  // remedy differs: a conflict is fixed by reloading and retrying, a duplicate
  // is fixed by changing the value.
  CONFLICT: 'CONFLICT',
  // The request body was over the cap a body parser enforces
  // (apps/api/src/common/http/body-parsers.ts), so the request was refused
  // before any handler saw it. Distinct from VALIDATION_ERROR: nothing about
  // the CONTENT was wrong, and re-sending the same payload cannot succeed. The
  // remedy is to send less (fewer rows in a batch, a smaller attachment), not
  // to correct a field.
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  // Auth-specific error codes
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  DISPOSABLE_EMAIL: 'DISPOSABLE_EMAIL',
  TURNSTILE_FAILED: 'TURNSTILE_FAILED',
  CSRF_FAILED: 'CSRF_FAILED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  EMAIL_IN_USE: 'EMAIL_IN_USE',
  // The account has no password at all (OAuth-only sign-in), so a flow that
  // re-verifies the current password cannot proceed. Points the caller at
  // password reset, which doubles as set-password. Only ever returned from
  // AUTHENTICATED, self-scoped procedures, where the caller already knows how
  // their own account signs in - the unauthenticated login path deliberately
  // returns the generic invalid-credentials error instead, so this code can
  // never be used to enumerate which accounts are OAuth-only.
  PASSWORD_NOT_SET: 'PASSWORD_NOT_SET',
  // Two-factor authentication
  // Generic wrong/invalid second-factor code (never distinguishes wrong-code
  // from replay/rate-limited to the client).
  TWO_FACTOR_INVALID_CODE: 'TWO_FACTOR_INVALID_CODE',
  // The pending challenge is gone (expired or attempts exhausted): the UI must
  // route back to the password step and start over.
  TWO_FACTOR_CHALLENGE_EXPIRED: 'TWO_FACTOR_CHALLENGE_EXPIRED',
  // Enforcement gate: the session belongs to a member whose Organization requires 2FA
  // and whose grace has passed; every non-allowlisted procedure returns this so
  // the SPA can route to the enroll-only screen.
  TWO_FACTOR_ENROLLMENT_REQUIRED: 'TWO_FACTOR_ENROLLMENT_REQUIRED',
} as const;

export type AppErrorCode = (typeof AppErrorCode)[keyof typeof AppErrorCode];
