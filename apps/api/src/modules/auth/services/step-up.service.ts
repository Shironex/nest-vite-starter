import { Injectable } from '@nestjs/common';
import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { AuditService } from '../../audit/audit.service';
import { ValidationError } from '../../../common/errors/domain-error';
import { AuthSharedService } from './auth-shared.service';
import { TotpService } from './totp.service';
import { SecondFactorRepository } from '../repositories/second-factor.repository';
import {
  TWO_FACTOR_MANAGE_RATE_LIMIT,
  TWO_FACTOR_MANAGE_RATE_SCOPE,
  TWO_FACTOR_MANAGE_RATE_WINDOW_SECONDS,
} from '../auth.constants';
import {
  isRecoveryCodeShape,
  isTotpCodeShape,
  normalizeRecoveryCode,
  normalizeTotpCode,
} from '../two-factor.util';
import { sha256Hex } from '../../../common/utils/crypto';
import { now } from '../../../common/clock';

/** Which kind of secret satisfied the check, or null when none did. */
export type SecondFactorMethod = 'totp' | 'recovery';

export interface IStepUpParams {
  readonly userId: string;
  /** The code the caller submitted, or undefined when they submitted none. */
  readonly code: string | undefined;
  readonly ip: string;
  /**
   * The flow asking, as it appears in the audit row's `metadata.context`
   * (`password_reset`, `email_change`, `staff_invite_accept`). A closed
   * vocabulary in practice, kept a string because the audit metadata is a JSON
   * blob and a union here would be a second list to keep in step.
   */
  readonly context: string;
  /**
   * The organization the refusal belongs to, for the flows that run UNAUTHENTICATED
   * and therefore have no tenant in the ALS for AuditService to read. Omit on
   * an authenticated flow, where the ALS already has it.
   */
  readonly tenantId?: string | null;
  /**
   * Called once, immediately before the throw, for a flow that also counts its
   * refusals (`recordAuthOutcome`). Not the audit row, which this service
   * always writes.
   */
  readonly onRefused?: () => void;
}

/**
 * The second-factor step-up gate: one implementation, four callers.
 *
 * WHAT IT IS. Three flows can change a credential or move an account, and each
 * must refuse to do so on one proof alone when the account carries an active
 * non-recovery factor:
 *
 *   - password reset, on mailbox proof (closes the mailbox-only lockout attack);
 *   - email change, on password sudo (the login identity is what 2FA protects);
 *   - staff-invite acceptance, which does strictly MORE than a reset on the
 *     collision path: it overwrites the credential, moves the account between
 *     organizations and changes its role.
 *
 * WHY IT IS ONE SERVICE. The sequence (find an active factor, spend one of the
 * per-user manage budget, verify by code shape, audit the failure, throw
 * TWO_FACTOR_INVALID_CODE) was hand-copied into all three, and two of the three
 * `verifyFactorCode` bodies were byte-identical. A security control maintained
 * in three places is a control where a change to recovery-code redemption, the
 * TOTP replay rule, the lockout key or the audit shape lands in whichever copy
 * the author happened to open.
 *
 * WHAT IT DELIBERATELY IS NOT. It does not decide WHETHER a flow needs a step
 * up: `assertSecondFactor` is a no-op for an account with no active factor, and
 * the caller is expected to invoke it unconditionally. Making the call
 * conditional at the call site is the optimization that turns into a hole the
 * day a new account class can enroll.
 */
@Injectable()
export class StepUpService {
  constructor(
    private readonly shared: AuthSharedService,
    private readonly totpService: TotpService,
    private readonly secondFactorRepository: SecondFactorRepository,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Refuse the caller unless they proved a second factor, when the account has
   * one to prove. Returns silently when the account has no active non-recovery
   * factor, which is the ordinary case and costs one indexed read.
   */
  async assertSecondFactor(params: IStepUpParams): Promise<void> {
    const activeFactor = await this.secondFactorRepository.findActiveNonRecovery(params.userId);
    if (activeFactor === null) return;

    await this.enforceManageRateLimit(params.userId);

    const method =
      params.code === undefined ? null : await this.verifyCode(params.userId, params.code);
    if (method !== null) return;

    await this.auditService.log({
      action: AUDIT_ACTIONS.AUTH_2FA_CHALLENGE_FAILURE,
      userId: params.userId,
      ...(params.tenantId === undefined ? {} : { tenantId: params.tenantId }),
      targetType: 'User',
      targetId: params.userId,
      success: false,
      ipAddress: params.ip,
      metadata: { reason: 'bad_code', context: params.context },
    });
    params.onRefused?.();
    throw new ValidationError(AppErrorCode.TWO_FACTOR_INVALID_CODE, 'Invalid code');
  }

  /**
   * Classify the submitted code by shape and verify it. Returns the method on
   * success or null on any failure, INCLUDING a code that matches neither
   * shape: a caller must never be able to tell "wrong code" from "not a code".
   *
   * Recovery redemption is atomic (`usedAt: null` predicate); TOTP carries its
   * own replay guard inside TotpService.
   */
  async verifyCode(userId: string, code: string): Promise<SecondFactorMethod | null> {
    if (isTotpCodeShape(code)) {
      const totp = await this.secondFactorRepository.findActiveTotp(userId);
      if (
        totp?.totpSecretEnc &&
        (await this.totpService.verify(userId, totp.totpSecretEnc, normalizeTotpCode(code)))
      ) {
        return 'totp';
      }
      return null;
    }
    if (isRecoveryCodeShape(code)) {
      const codeHash = sha256Hex(normalizeRecoveryCode(code));
      if (await this.secondFactorRepository.redeemRecoveryCode(userId, codeHash, now())) {
        return 'recovery';
      }
      return null;
    }
    return null;
  }

  /**
   * Spend one of the per-user manage budget. Per-user rather than per-IP: a
   * hijacked session can rotate addresses, so an IP budget would not bound the
   * guessing this exists to bound.
   */
  async enforceManageRateLimit(userId: string): Promise<void> {
    await this.shared.enforceRateLimit(
      `${TWO_FACTOR_MANAGE_RATE_SCOPE}:${userId}`,
      TWO_FACTOR_MANAGE_RATE_LIMIT,
      TWO_FACTOR_MANAGE_RATE_WINDOW_SECONDS,
    );
  }
}
