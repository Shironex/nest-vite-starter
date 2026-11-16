import { createAppLogger } from '../logger/logger.service';

const logger = createAppLogger('Auth');

/**
 * The authentication flows worth logging separately. Closed set: these are
 * structured log fields, so they are written at the call site and never derived
 * from anything a caller controls.
 */
export type AuthFlow = 'login' | 'twofa_challenge' | 'password_reset' | 'session_mint';

/**
 * Whether an outcome is the flow succeeding or the flow refusing. Only the
 * log level depends on it.
 */
export type AuthOutcomeKind = 'success' | 'refusal';

export interface IAuthOutcome {
  readonly flow: AuthFlow;
  /**
   * Why the flow ended the way it did (`unknown_email`, `bad_password`,
   * `locked`, `membership_ended`, `fence`, `ok`, ...). Matches the audit row's
   * reason rather than restating an error message.
   */
  readonly outcome: string;
  readonly kind: AuthOutcomeKind;
  /**
   * Absent on the pre-authentication branches that never resolve a user (an
   * unknown email is the whole point of the account-enumeration defense).
   */
  readonly userId?: string | undefined;
}

/**
 * One structured line per authentication outcome, beside the existing
 * `auditService.log` call rather than instead of it. The audit row stays the
 * durable record; this is the ops signal a log pipeline can alert on ("is the
 * lockout rate climbing", "did 2FA start failing") without SQL over a table
 * whose writes are best effort.
 *
 * NEVER pass the credential, the email, the token or the error message. The
 * flow, the outcome and the user id are the whole payload: `userId` is an
 * identifier the audit trail already stores raw in a queryable column, and it
 * is what answers "which account" during an incident.
 */
export function recordAuthOutcome({ flow, outcome, kind, userId }: IAuthOutcome): void {
  const details = { op: `auth.${flow}`, outcome, ...(userId === undefined ? {} : { userId }) };
  if (kind === 'success') {
    logger.info('auth outcome', details);
  } else {
    logger.warn('auth outcome refused', details);
  }
}
