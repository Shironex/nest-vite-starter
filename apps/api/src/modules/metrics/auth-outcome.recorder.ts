import { createAppLogger } from '../logger/logger.service';
import { authOutcomesTotal } from './metrics.registry';

const logger = createAppLogger('Auth');

/**
 * The authentication flows worth counting separately. Closed set: these are
 * Prometheus labels, so they are written at the call site and never derived
 * from anything a caller controls.
 */
export type AuthFlow =
  'login' | 'twofa_challenge' | 'oauth_callback' | 'password_reset' | 'session_mint';

/**
 * Whether an outcome is the flow succeeding or the flow refusing. Only the
 * log level depends on it: both are counted.
 */
export type AuthOutcomeKind = 'success' | 'refusal';

export interface IAuthOutcome {
  readonly flow: AuthFlow;
  /**
   * Why the flow ended the way it did (`unknown_email`, `bad_password`,
   * `locked`, `membership_ended`, `fence`, `ok`, ...). Also a label, so it
   * matches the audit row's reason rather than restating an error message.
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
 * One counter increment plus one structured line per authentication outcome,
 * beside the existing `auditService.log` call rather than instead of it.
 *
 * Auth outcomes used to be audit rows and nothing else, so neither Prometheus
 * nor Loki could answer "is the lockout rate climbing", "did 2FA start
 * failing", "is the epoch fence refusing mints" without SQL over a table whose
 * writes are best effort. The audit row stays the durable record; this is the
 * ops signal.
 *
 * NEVER pass the credential, the email, the token or the error message. The
 * flow, the outcome and the user id are the whole payload: `userId` is an
 * identifier the audit trail already stores raw in a queryable column, and it
 * is what answers "which account" during an incident.
 */
export function recordAuthOutcome({ flow, outcome, kind, userId }: IAuthOutcome): void {
  authOutcomesTotal.labels(flow, outcome).inc();

  const details = { op: `auth.${flow}`, outcome, ...(userId === undefined ? {} : { userId }) };
  if (kind === 'success') {
    logger.info('auth outcome', details);
  } else {
    logger.warn('auth outcome refused', details);
  }
}
