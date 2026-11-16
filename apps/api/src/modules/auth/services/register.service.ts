import { Injectable, Logger } from '@nestjs/common';
import type { User } from '@repo/database' with { 'resolution-mode': 'import' };
import type { Request, Response } from 'express';
import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { ForbiddenError, ValidationError } from '../../../common/errors';
import {
  isPrismaUniqueConstraintError,
  uniqueConstraintTargetText,
} from '../prisma-unique-error.util';
import { PasswordService } from './password.service';
import { ProvisioningService } from './provisioning.service';
import { AuthSharedService } from './auth-shared.service';
import { UserService, IUserProfile } from '../../user/user.service';
import { MailService } from '../../mail/mail.service';
import { AuditService } from '../../audit/audit.service';

export interface IRegisterResult {
  user: IUserProfile;
  requiresVerification: boolean;
  /**
   * Whether the verification email was successfully ENQUEUED (delivery itself
   * is async, retried, and DLQ-backed). False when the enqueue threw, so the
   * client can surface a "we could not send the email, use resend" hint
   * instead of leaving the user waiting for mail that never comes. Additive
   * field: existing web callers ignore it safely.
   */
  emailSent: boolean;
}

@Injectable()
export class RegisterService {
  private readonly logger = new Logger(RegisterService.name);

  constructor(
    private readonly passwordService: PasswordService,
    private readonly provisioningService: ProvisioningService,
    private readonly userService: UserService,
    private readonly mailService: MailService,
    private readonly auditService: AuditService,
    private readonly shared: AuthSharedService,
  ) {}

  /**
   * Register a new user with email/password.
   * Creates account, enqueues the verification email, creates session.
   */
  async register(
    input: {
      email: string;
      password: string;
      displayName?: string | undefined;
      turnstileToken: string;
    },
    ip: string,
    userAgent: string,
    req: Request,
    res: Response,
  ): Promise<IRegisterResult> {
    await this.shared.enforceAuthRateLimit('register', ip);
    await this.shared.validateTurnstile(input.turnstileToken, ip);

    // Check disposable email
    const isDisposable = await this.userService.isDisposableEmail(input.email);
    if (isDisposable) {
      throw new ForbiddenError(AppErrorCode.DISPOSABLE_EMAIL);
    }

    // Check if email already exists
    const existing = await this.userService.findByEmail(input.email);
    if (existing) {
      throw new ValidationError(AppErrorCode.EMAIL_IN_USE, AppErrorCode.EMAIL_IN_USE);
    }

    // Hash password and create the organization + owner + verification token atomically
    const passwordHash = await this.passwordService.hash(input.password);
    const normalizedEmail = this.userService.normalizeEmail(input.email);

    let user: User;
    let rawVerificationToken: string;
    try {
      ({ user, rawVerificationToken } =
        await this.provisioningService.provisionOrganizationForPasswordSignup({
          normalizedEmail,
          passwordHash,
          displayName: input.displayName ?? null,
        }));
    } catch (error) {
      // The email pre-check is best-effort: a concurrent double-submit (or a
      // re-register of a soft-deleted email) races past it and trips the
      // User.email unique constraint inside the provisioning transaction,
      // throwing Prisma P2002. Map it to the SAME clean error the pre-check
      // throws so the client sees a 400/EMAIL_IN_USE instead of an untranslated
      // 500. Duck-typed (not `instanceof Prisma.*`) so a value import of the
      // ESM-only Prisma client never drags the WASM query compiler into this
      // CJS path.
      //
      // Branch on the violated constraint: that tx ALSO writes Tenant.slug, which
      // is @unique, so a blanket map would mislabel a slug collision as
      // "email in use". Only an email-constraint violation (or a P2002 whose
      // target the driver does not report - email is the realistic cause) maps
      // to EMAIL_IN_USE; a slug collision is an unexpected internal condition and
      // is rethrown rather than mislabeled.
      if (isPrismaUniqueConstraintError(error)) {
        const target = uniqueConstraintTargetText(error);
        if (target === undefined || target.includes('email')) {
          throw new ValidationError(AppErrorCode.EMAIL_IN_USE, AppErrorCode.EMAIL_IN_USE);
        }
      }
      throw error;
    }
    return this.finalizeRegistration({ user, rawVerificationToken, ip, userAgent, req, res });
  }

  /**
   * Post-transaction side effects: verification email, session, cookie, CSRF
   * rotation, and the success audit entry. Split out so `register` keeps only
   * the P2002 mapping around the provisioning transaction.
   */
  private async finalizeRegistration(args: {
    user: User;
    rawVerificationToken: string;
    ip: string;
    userAgent: string;
    req: Request;
    res: Response;
  }): Promise<IRegisterResult> {
    const { user, rawVerificationToken, ip, userAgent, req, res } = args;
    const verificationUrl = `${this.shared.appUrl}/auth/verify-email?token=${rawVerificationToken}`;

    // Await only the ENQUEUE (delivery is async on the email-delivery queue).
    // An enqueue failure must not fail registration; it is reported to the
    // client as emailSent: false so the UI can point the user at
    // resend-verification instead of waiting for mail that never arrives.
    let emailSent = true;
    try {
      await this.mailService.sendVerificationEmail(user.email, verificationUrl);
    } catch (error) {
      emailSent = false;
      this.logger.error('Failed to enqueue verification email during registration', error);
    }

    // Create session + set cookie + rotate CSRF in the one shared path
    // (unverified users CAN log in per CONTEXT.md). The owner always has a
    // tenant (the organization just created in the transaction).
    //
    // No epoch is captured here: the account did not exist when this request
    // started, so there is no earlier credential read for the fence to cover
    // and no revocation that could already be in flight against it.
    // createSession reads the (absent, therefore 0) counter itself.
    await this.shared.establishSession(req, res, {
      userId: user.id,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerified,
      ip,
      userAgent,
      rememberMe: false,
      tenantId: user.tenantId,
    });

    await this.auditService.log({
      action: AUDIT_ACTIONS.AUTH_REGISTER_SUCCESS,
      userId: user.id,
      // This runs BEFORE AuthMiddleware sets the ALS tenant, so the row would
      // otherwise land with tenantId null. Pass the new owner's tenant id
      // explicitly (AuditService honors an explicit tenantId over the ALS).
      tenantId: user.tenantId,
      targetType: 'User',
      targetId: user.id,
      ipAddress: ip,
      userAgent,
    });

    // Build the profile from the row created in the transaction (the full User
    // row, a superset of the getProfile projection) instead of paying a second
    // SELECT, mirroring login.service.ts. Project explicitly so credential
    // fields (passwordHash, lockout counters) cannot leak into the response.
    const profile: IUserProfile = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
    };
    return { user: profile, requiresVerification: true, emailSent };
  }
}
