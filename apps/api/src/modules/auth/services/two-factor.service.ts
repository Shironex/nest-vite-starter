import { Injectable, Logger } from '@nestjs/common';
import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { ConflictError, UnauthorizedError, ValidationError } from '../../../common/errors';
import { sha256Hex } from '../../../common/utils/crypto';
import { now } from '../../../common/clock';
import { PrismaService } from '../../../common/database/prisma.service';
import { UserService } from '../../user/user.service';
import { MailService } from '../../mail/mail.service';
import { AuditService } from '../../audit/audit.service';
import {
  LOW_RECOVERY_CODES_THRESHOLD,
  PENDING_ENROLLMENT_EXPIRY_MS,
  RECOVERY_CODE_COUNT,
} from '../auth.constants';
import { PasswordService } from './password.service';
import { AuthSharedService } from './auth-shared.service';
import { TotpService } from './totp.service';
import { StepUpService } from './step-up.service';
import { TrustedDeviceService } from './trusted-device.service';
import { SecondFactorRepository } from '../repositories/second-factor.repository';
import {
  formatRecoveryCode,
  generateRecoveryCode,
  isRecoveryCodeShape,
  isTotpCodeShape,
  normalizeRecoveryCode,
  normalizeTotpCode,
} from '../two-factor.util';

export interface IBeginEnrollmentResult {
  otpauthUri: string;
  secretBase32: string;
}

export interface ITwoFactorStatus {
  enabled: boolean;
  methods: string[];
  recoveryCodesRemaining: number;
  lowRecoveryCodes: boolean;
  pendingEnrollment: boolean;
  trustedDeviceCount: number;
}

/**
 * TOTP enrollment lifecycle: begin (provision secret), activate (confirm code +
 * mint recovery codes), disable, and regenerate recovery codes. Every mutating
 * method is password-sudo-gated so a stolen session alone cannot add or strip a
 * factor, per-user rate limited, and audited. The login CHALLENGE (pre-session
 * verify) lives on the public auth router and in TwoFactorChallengeService, not
 * here.
 */
@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);

  constructor(
    private readonly passwordService: PasswordService,
    private readonly userService: UserService,
    private readonly totpService: TotpService,
    private readonly stepUpService: StepUpService,
    private readonly trustedDeviceService: TrustedDeviceService,
    private readonly secondFactorRepository: SecondFactorRepository,
    private readonly auditService: AuditService,
    private readonly mailService: MailService,
    private readonly prismaService: PrismaService,
    private readonly shared: AuthSharedService,
  ) {}

  /**
   * Password sudo gate shared by every management action: verifies the current
   * password against the credential row and returns it. A hijacked session
   * cannot pass this without the password.
   */
  private async requireSudo(userId: string, password: string) {
    const user = await this.userService.findCredentialById(userId);
    if (!user) {
      throw new UnauthorizedError(AppErrorCode.UNAUTHORIZED, 'Session is no longer valid');
    }
    // An account with no password cannot clear this gate: there is nothing to
    // prove. Fail CLOSED rather than waving the sudo check through, since that
    // would let a hijacked session enroll or disable a second factor with no
    // proof at all. The dedicated appCode points at password reset, which
    // doubles as set-password; authenticated and self-scoped, so it reveals
    // nothing about any other account.
    if (user.passwordHash === null) {
      throw new ValidationError(
        AppErrorCode.PASSWORD_NOT_SET,
        'No password is set on this account. Use password reset to set one.',
      );
    }
    const valid = await this.passwordService.verify(user.passwordHash, password);
    if (!valid) {
      throw new UnauthorizedError(AppErrorCode.INVALID_CREDENTIALS, 'Password is incorrect');
    }
    return user;
  }

  /**
   * Delegated so the budget is genuinely shared: the four flows that spend it
   * must spell the scope the same way, and the literal used to appear at each
   * of them.
   */
  private async enforceManageRateLimit(userId: string): Promise<void> {
    await this.stepUpService.enforceManageRateLimit(userId);
  }

  /** Generate `RECOVERY_CODE_COUNT` codes; return plaintext + their hashes. */
  private mintRecoveryCodes(): { plaintext: string[]; hashes: string[] } {
    const plaintext: string[] = [];
    const hashes: string[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i += 1) {
      const code = generateRecoveryCode();
      plaintext.push(formatRecoveryCode(code));
      hashes.push(sha256Hex(code));
    }
    return { plaintext, hashes };
  }

  /**
   * Step 1 of enrollment: provision a secret and return the otpauth URI + base32
   * for the client to render a QR / manual entry. Refuses if TOTP is already
   * active (replace is disable + enroll), and replaces any stale PENDING row.
   */
  async beginEnrollment(
    userId: string,
    password: string,
    ip: string,
    userAgent: string,
  ): Promise<IBeginEnrollmentResult> {
    await this.enforceManageRateLimit(userId);
    const user = await this.requireSudo(userId, password);

    if (await this.secondFactorRepository.findActiveTotp(userId)) {
      throw new ConflictError(
        AppErrorCode.ALREADY_EXISTS,
        'Two-factor authentication is already enabled',
      );
    }

    const { secretBase32, otpauthUri } = this.totpService.generateSecret(user.email);
    const totpSecretEnc = this.totpService.encryptSecret(secretBase32);
    // Replace-then-create in ONE transaction so two concurrent begins cannot
    // interleave into two PENDING rows with different secrets (activate would
    // then confirm an arbitrary one).
    await this.prismaService.client.$transaction(async (tx) => {
      await this.secondFactorRepository.deletePendingTotp(userId, tx);
      await this.secondFactorRepository.createPendingTotp({ userId, totpSecretEnc }, tx);
    });

    await this.auditService.log({
      action: AUDIT_ACTIONS.AUTH_2FA_ENROLL_BEGIN,
      userId,
      targetType: 'User',
      targetId: userId,
      ipAddress: ip,
      userAgent,
    });

    // The URI embeds the secret; return it but never log it.
    return { otpauthUri, secretBase32 };
  }

  /**
   * Step 2 of enrollment: confirm the first code, flip PENDING -> ACTIVE, and
   * mint the recovery codes in ONE transaction. Codes are shown exactly once.
   */
  async activate(
    userId: string,
    code: string,
    ip: string,
    userAgent: string,
  ): Promise<{ recoveryCodes: string[] }> {
    await this.enforceManageRateLimit(userId);

    const pending = await this.secondFactorRepository.findPendingTotp(userId);
    if (!pending || !pending.totpSecretEnc) {
      throw new ValidationError(
        AppErrorCode.VALIDATION_ERROR,
        'Enrollment session expired, please start again',
      );
    }
    // The 1-hour activation cutoff is the correctness backstop; the hourly sweep
    // (Step 5) is only hygiene on top.
    if (pending.createdAt.getTime() + PENDING_ENROLLMENT_EXPIRY_MS < now().getTime()) {
      await this.secondFactorRepository.deletePendingTotp(userId);
      throw new ValidationError(
        AppErrorCode.VALIDATION_ERROR,
        'Enrollment session expired, please start again',
      );
    }

    const valid = await this.totpService.verify(
      userId,
      pending.totpSecretEnc,
      normalizeTotpCode(code),
    );
    if (!valid) {
      throw new ValidationError(AppErrorCode.TWO_FACTOR_INVALID_CODE, 'Invalid code');
    }

    const { plaintext, hashes } = this.mintRecoveryCodes();
    const activatedAt = now();
    try {
      await this.prismaService.client.$transaction(async (tx) => {
        // CAS: only the activate that flips the row from PENDING mints codes.
        const flipped = await this.secondFactorRepository.activateTotp(pending.id, activatedAt, tx);
        if (flipped !== 1) {
          throw new ValidationError(
            AppErrorCode.VALIDATION_ERROR,
            'Enrollment session expired, please start again',
          );
        }
        await this.secondFactorRepository.createRecoveryCodes(userId, hashes, tx);
      });
    } catch (err) {
      // The partial unique index (SecondFactor_active_totp_per_user_key) rejects
      // a second ACTIVE TOTP when a racing tab activated a different pending row
      // first: surface it as the same benign "already enabled" the pre-check uses.
      if (isPrismaUniqueConstraintError(err)) {
        throw new ConflictError(
          AppErrorCode.ALREADY_EXISTS,
          'Two-factor authentication is already enabled',
        );
      }
      throw err;
    }

    await this.auditService.log({
      action: AUDIT_ACTIONS.AUTH_2FA_ENABLED,
      userId,
      targetType: 'User',
      targetId: userId,
      ipAddress: ip,
      userAgent,
    });

    // Confirm the new second factor by email (best-effort, non-critical), the
    // mirror of the disable notification. Enabling a second factor is a
    // high-signal security event, so the owner hears about it even if they did
    // not initiate it (account takeover surfaces here).
    try {
      const user = await this.userService.findById(userId);
      if (user) {
        await this.mailService.sendTwoFactorEnabledEmail(user.email);
      }
    } catch (error) {
      this.logger.error('Failed to send 2FA enabled email', error);
    }

    return { recoveryCodes: plaintext };
  }

  /**
   * Disable 2FA. Requires password AND a current TOTP or recovery code so a
   * session thief cannot strip the account's second factor. Hard-deletes every
   * factor row. (Trusted-device revocation is wired in Step 4.)
   */
  async disable(
    userId: string,
    password: string,
    code: string,
    ip: string,
    userAgent: string,
  ): Promise<void> {
    await this.enforceManageRateLimit(userId);
    const user = await this.requireSudo(userId, password);

    const activeTotp = await this.secondFactorRepository.findActiveTotp(userId);
    if (!activeTotp) {
      throw new ValidationError(
        AppErrorCode.VALIDATION_ERROR,
        'Two-factor authentication is not enabled',
      );
    }

    const codeValid = await this.verifyDisableCode(userId, activeTotp.totpSecretEnc, code);
    if (!codeValid) {
      throw new ValidationError(AppErrorCode.TWO_FACTOR_INVALID_CODE, 'Invalid code');
    }

    await this.secondFactorRepository.deleteAllForUser(userId);
    // Trust asserts "this browser passed 2FA"; with 2FA gone the assertion is
    // meaningless and must not survive a later re-enroll.
    await this.trustedDeviceService.revokeAll(userId);

    await this.auditService.log({
      action: AUDIT_ACTIONS.AUTH_2FA_DISABLED,
      userId,
      targetType: 'User',
      targetId: userId,
      ipAddress: ip,
      userAgent,
    });

    try {
      await this.mailService.sendTwoFactorDisabledEmail(user.email);
    } catch (error) {
      this.logger.error('Failed to send 2FA disabled email', error);
    }
  }

  /**
   * Revoke every trusted device for the caller (the settings "revoke all trusted
   * devices" action). Recovery-code regeneration deliberately does NOT touch
   * trust; disable and reset do.
   */
  async revokeTrustedDevices(userId: string, ip: string, userAgent: string): Promise<void> {
    await this.trustedDeviceService.revokeAll(userId);
    await this.auditService.log({
      action: AUDIT_ACTIONS.AUTH_2FA_TRUST_REVOKED,
      userId,
      targetType: 'User',
      targetId: userId,
      ipAddress: ip,
      userAgent,
    });
  }

  /**
   * A disable code may be either a current TOTP or an unused recovery code.
   * Since every factor is deleted immediately after, redeeming the recovery code
   * here is harmless; it still proves possession of a valid code.
   */
  private async verifyDisableCode(
    userId: string,
    totpSecretEnc: string | null,
    code: string,
  ): Promise<boolean> {
    if (isTotpCodeShape(code) && totpSecretEnc) {
      return this.totpService.verify(userId, totpSecretEnc, normalizeTotpCode(code));
    }
    if (isRecoveryCodeShape(code)) {
      const codeHash = sha256Hex(normalizeRecoveryCode(code));
      return this.secondFactorRepository.redeemRecoveryCode(userId, codeHash, now());
    }
    return false;
  }

  /**
   * Regenerate recovery codes: password-sudo-gated, transactional replace-all.
   * Codes are shown exactly once.
   */
  async regenerateRecoveryCodes(
    userId: string,
    password: string,
    ip: string,
    userAgent: string,
  ): Promise<{ recoveryCodes: string[] }> {
    await this.enforceManageRateLimit(userId);
    await this.requireSudo(userId, password);

    if (!(await this.secondFactorRepository.findActiveTotp(userId))) {
      throw new ValidationError(
        AppErrorCode.VALIDATION_ERROR,
        'Two-factor authentication is not enabled',
      );
    }

    const { plaintext, hashes } = this.mintRecoveryCodes();
    await this.prismaService.client.$transaction(async (tx) => {
      await this.secondFactorRepository.deleteRecoveryCodes(userId, tx);
      await this.secondFactorRepository.createRecoveryCodes(userId, hashes, tx);
    });

    await this.auditService.log({
      action: AUDIT_ACTIONS.AUTH_2FA_RECOVERY_REGENERATED,
      userId,
      targetType: 'User',
      targetId: userId,
      ipAddress: ip,
      userAgent,
    });

    return { recoveryCodes: plaintext };
  }

  /**
   * Settings surface. `enabled` is derived (no User flag).
   */
  async status(userId: string): Promise<ITwoFactorStatus> {
    const [activeFactor, pending, recoveryCodesRemaining, trustedDeviceCount] = await Promise.all([
      this.secondFactorRepository.findActiveNonRecovery(userId),
      this.secondFactorRepository.findPendingTotp(userId),
      this.secondFactorRepository.countUnusedRecoveryCodes(userId),
      this.trustedDeviceService.count(userId),
    ]);

    const enabled = activeFactor !== null;
    return {
      enabled,
      methods: enabled && activeFactor ? [activeFactor.type] : [],
      recoveryCodesRemaining,
      lowRecoveryCodes: enabled && recoveryCodesRemaining <= LOW_RECOVERY_CODES_THRESHOLD,
      pendingEnrollment: pending !== null,
      trustedDeviceCount,
    };
  }
}

/**
 * Duck-typed check for a Prisma P2002 unique-constraint violation. Mirrors
 * register.service.ts / trpc.error-handler.ts: a value import of the ESM-only
 * Prisma client into this CJS service would drag the WASM query compiler through
 * jest's transform, so we never `instanceof Prisma.PrismaClientKnownRequestError`.
 */
function isPrismaUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'P2002'
  );
}
