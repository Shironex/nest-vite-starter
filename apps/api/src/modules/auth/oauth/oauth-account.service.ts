import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '@repo/database' with { 'resolution-mode': 'import' };
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { AppErrorCode } from '@repo/shared/errors';
import { NotFoundError, UnauthorizedError, ValidationError } from '../../../common/errors';
import { PrismaService } from '../../../common/database/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { SessionRevocationService } from '../../events/session-revocation.service';
import { MailService } from '../../mail/mail.service';
import { UserService } from '../../user/user.service';
import { SecondFactorRepository } from '../repositories/second-factor.repository';
import {
  isPrismaUniqueConstraintError,
  uniqueConstraintTargetText,
} from '../prisma-unique-error.util';
import { LockoutService } from '../services/lockout.service';
import { ProvisioningService } from '../services/provisioning.service';
import { SessionService } from '../services/session.service';
import type { IChallengeUser } from '../services/two-factor-challenge.service';
import { OAUTH_ERROR_CODES, oauthProviderLabel, type OAuthErrorCode } from './oauth.constants';
import type { IOAuthIdentity } from './providers/oauth-provider.interface';

/** Request attribution rode by every audit row this service writes. */
export interface IOAuthRequestContext {
  ip: string;
  userAgent: string;
}

/**
 * Outcome of the login-intent resolution (SPEC section 7). `authenticated`
 * hands the controller everything `beginOrEstablish` needs, INCLUDING the
 * session epoch captured at the credential read (see resolveLogin); `rejected`
 * carries the wire error code, the audit row having already been written here.
 */
export type OAuthLoginResolution =
  | { outcome: 'authenticated'; user: IChallengeUser; epoch: number }
  | { outcome: 'rejected'; errorCode: OAuthErrorCode };

/**
 * The projection both resolution lookups share. Deliberately NOT the
 * repository's credential finder: this flow never verifies a password, so
 * `passwordHash` (and the lockout counters) must not even be loaded, but it
 * DOES need `tenantId` (for the session + explicit audit stamping) and the
 * `deletedAt`/`lockedUntil`/`membershipEndedAt` gate fields the profile
 * projection omits.
 */
const RESOLUTION_USER_SELECT = {
  id: true,
  email: true,
  role: true,
  emailVerified: true,
  tenantId: true,
  deletedAt: true,
  lockedUntil: true,
  // A member removed from their organization keeps the row, its tenantId, its role
  // and every OAuthAccount link (removal is a flag, not a detach), so without
  // this the link row alone would sign them straight back into that organization.
  membershipEndedAt: true,
} as const;

interface IResolutionUser {
  id: string;
  email: string;
  role: string;
  emailVerified: boolean;
  tenantId: string | null;
  deletedAt: Date | null;
  lockedUntil: Date | null;
  membershipEndedAt: Date | null;
}

/**
 * Account resolution for the OAuth callback: sign in, auto-link or sign up.
 *
 * Identity is ALWAYS `(provider, sub)`; the row's `email` is a snapshot and is
 * never used as a lookup key for an already-linked account. Failures never
 * throw to the caller: every branch returns a wire error code AND writes its
 * own `oauth.failure` audit row (explicit tenantId where a user is known;
 * these paths run before AuthMiddleware seeds the ALS). Lockout counters are
 * never incremented here: an OAuth failure is not a password guess.
 */
@Injectable()
export class OAuthAccountService {
  private readonly logger = new Logger(OAuthAccountService.name);
  private readonly allowSignup: boolean;

  constructor(
    configService: ConfigService,
    private readonly prismaService: PrismaService,
    private readonly userService: UserService,
    private readonly sessionService: SessionService,
    private readonly lockoutService: LockoutService,
    private readonly provisioningService: ProvisioningService,
    private readonly secondFactorRepository: SecondFactorRepository,
    private readonly auditService: AuditService,
    private readonly mailService: MailService,
    private readonly sessionRevocation: SessionRevocationService,
  ) {
    // Joi has already validated/defaulted the flag (default true).
    this.allowSignup = configService.get<boolean>('OAUTH_ALLOW_SIGNUP') !== false;
  }

  /**
   * SPEC section 7, top to bottom: linked account -> email conflict -> signup.
   *
   * Session-epoch capture point: the state that authenticates an OAuth login
   * is the LINK ROW (or, on the auto-link branch, the user row the verified
   * email resolves to); there is no argon2 verify here. The epoch counter is
   * keyed by userId, which only that read produces, so the epoch is captured
   * immediately AFTER the row read and BEFORE every subsequent check and
   * write, mirroring LoginService.login (which captures right after the
   * credential row fetch). A revocation landing anywhere between that read and
   * the mint then fails the mint via the createSession re-check instead of
   * racing it.
   */
  async resolveLogin(
    identity: IOAuthIdentity,
    ctx: IOAuthRequestContext,
  ): Promise<OAuthLoginResolution> {
    const email = this.userService.normalizeEmail(identity.email);

    // 1. Already linked? (provider, sub) is the only identity key.
    const linked = await this.prismaService.client.oAuthAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: identity.provider,
          providerAccountId: identity.subject,
        },
      },
      select: { id: true, userId: true, user: { select: RESOLUTION_USER_SELECT } },
    });
    if (linked) {
      return this.resolveLinkedLogin(linked, identity, email, ctx);
    }

    // 2. Email conflict: the address belongs to an existing account.
    const existing = await this.findResolutionUserByEmail(email);
    if (existing) {
      return this.resolveAutoLink(existing, identity, email, ctx);
    }

    // 3. Signup.
    return this.resolveSignup(identity, email, ctx);
  }

  private async resolveLinkedLogin(
    linked: { id: string; userId: string; user: IResolutionUser },
    identity: IOAuthIdentity,
    email: string,
    ctx: IOAuthRequestContext,
  ): Promise<OAuthLoginResolution> {
    // Fence capture: the link row (the credential) has just been read; grab
    // the counter before anything slower can widen the race window.
    const epoch = await this.sessionService.readEpoch(linked.userId);
    const user = linked.user;

    // Mirror password login's restore-or-reject parity: a
    // soft-deleted account's Google login is rejected exactly like its
    // password login (which never finds the row). Generic code on the wire.
    if (user.deletedAt !== null) {
      await this.auditFailure(identity, 'account_deleted', ctx, user);
      return { outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.FAILED };
    }
    // Locked is locked, whatever the credential. The wire code stays generic
    // (the /auth error map has no lockout arm); the audit reason does not.
    if (this.lockoutService.isLockedFromUser(user).locked) {
      await this.auditFailure(identity, 'account_locked', ctx, user);
      return { outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.FAILED };
    }
    // Removed from the organization: password login's `membership_ended` refusal,
    // restated for the provider door. Same generic wire code as the rest.
    if (user.membershipEndedAt !== null) {
      await this.auditFailure(identity, 'membership_ended', ctx, user);
      return { outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.FAILED };
    }

    // Snapshot drift: refresh the row's email copy (never User.email) and let
    // @updatedAt stamp lastUsedAt for the Connected Accounts panel.
    await this.prismaService.client.oAuthAccount.update({
      where: { id: linked.id },
      data: { email },
    });

    await this.auditService.log({
      action: AUDIT_ACTIONS.OAUTH_LOGIN,
      userId: user.id,
      tenantId: user.tenantId,
      targetType: 'User',
      targetId: user.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { provider: identity.provider, providerAccountId: identity.subject },
    });

    return { outcome: 'authenticated', user: this.toChallengeUser(user), epoch };
  }

  /**
   * The conflict case (tightened by the zero-factors gate and against
   * account pre-hijacking): auto-link ONLY when the email is verified on BOTH sides,
   * the account has ZERO active second factors of any type AND it has NO
   * password. An account protected by a factor or a password never gains a new
   * sign-in method from a login attempt; its owner signs in the usual way and
   * links explicitly from settings (sudo-gated) instead.
   */
  private async resolveAutoLink(
    user: IResolutionUser,
    identity: IOAuthIdentity,
    email: string,
    ctx: IOAuthRequestContext,
  ): Promise<OAuthLoginResolution> {
    // Fence capture, same reasoning as the linked branch: the user row the
    // verified email resolved to IS the state this login rests on. The
    // authenticating arm below bumps the counter itself before it mints, and
    // hands the seam this value plus that one bump (see there).
    const epoch = await this.sessionService.readEpoch(user.id);

    const locked = this.lockoutService.isLockedFromUser(user).locked;
    const doubleVerified = identity.emailVerified && user.emailVerified;

    if (doubleVerified && user.deletedAt === null && !locked) {
      // Removed from the organization: refused before the factor gate and before the
      // link row is written, so a removed member never gains a sign-in method.
      // Only inside the double-verified arm, deliberately: refusing earlier
      // would answer an unverified identity differently for a removed member
      // than for anyone else, an oracle for who has left which organization.
      if (user.membershipEndedAt !== null) {
        await this.auditFailure(identity, 'membership_ended', ctx, user);
        return { outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.FAILED };
      }

      // Zero-factors gate: ANY active factor (recovery codes included) blocks the
      // auto-link. beginOrEstablish re-checks factors at mint time anyway, so
      // a factor enrolled between this read and the mint still challenges.
      if ((await this.secondFactorRepository.findAnyActive(user.id)) !== null) {
        await this.auditFailure(identity, 'link_blocked_second_factor', ctx, user);
        return { outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.LINK_BLOCKED };
      }

      // Password accounts never auto-link (account pre-hijacking). The
      // password was chosen before anyone proved control of the inbox: an
      // attacker can register the victim's address with their own password,
      // and once the victim verifies the address, a Google sign-in here would
      // hand the victim an account whose password the attacker still knows.
      // The owner signs in with the password (or resets it, which replaces it)
      // and links Google from settings. Same wire code as the factor gate.
      if (await this.hasPassword(user.id)) {
        await this.auditFailure(identity, 'link_blocked_password_account', ctx, user);
        return { outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.LINK_BLOCKED };
      }

      try {
        await this.prismaService.client.oAuthAccount.create({
          data: {
            provider: identity.provider,
            providerAccountId: identity.subject,
            email,
            emailVerified: identity.emailVerified,
            userId: user.id,
          },
        });
      } catch (error) {
        // A concurrent callback for the same sub already linked it (possibly
        // to another user): the unique index is the arbiter, not our read.
        if (isPrismaUniqueConstraintError(error)) {
          await this.auditFailure(identity, 'account_exists', ctx, user);
          return { outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.ACCOUNT_EXISTS };
        }
        throw error;
      }

      // A new sign-in method just attached itself to an existing account, so
      // every session minted before it dies, sockets included.
      await this.sessionRevocation.revokeAllAndDisconnect(user.id);

      await this.sendLinkTripwire(user.email, identity.provider);
      await this.auditService.log({
        action: AUDIT_ACTIONS.OAUTH_LINK,
        userId: user.id,
        tenantId: user.tenantId,
        targetType: 'User',
        targetId: user.id,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { provider: identity.provider, providerAccountId: identity.subject, auto: true },
      });

      // The revocation above is exactly one INCR of the counter, so the epoch
      // this login may mint under is the pre-check capture plus one. Handing
      // over the stale capture would fence the new session out the moment it
      // was written; re-reading the counter instead would also absorb any
      // OTHER revocation (a member removal, a role change) that landed after
      // the gate reads above, and mint through it. With `epoch + 1` the seam's
      // re-check refuses the mint whenever anyone but this call bumped it.
      return { outcome: 'authenticated', user: this.toChallengeUser(user), epoch: epoch + 1 };
    }

    // Not eligible for auto-link and not blocked by a factor: the generic
    // account-exists arm. The audit reason keeps the precise gate.
    const reason = !identity.emailVerified
      ? 'identity_email_unverified'
      : !user.emailVerified
        ? 'user_email_unverified'
        : locked
          ? 'account_locked'
          : 'account_deleted';
    await this.auditFailure(identity, reason, ctx, user);
    return { outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.ACCOUNT_EXISTS };
  }

  private async resolveSignup(
    identity: IOAuthIdentity,
    email: string,
    ctx: IOAuthRequestContext,
  ): Promise<OAuthLoginResolution> {
    if (!this.allowSignup) {
      await this.auditFailure(identity, 'signup_disabled', ctx);
      return { outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.SIGNUP_DISABLED };
    }
    // Never trust an unverified claim: an attacker-controlled
    // IdP address must not become a provisioned account, and the wire code is
    // the generic one so the response does not teach the attacker why.
    if (!identity.emailVerified) {
      await this.auditFailure(identity, 'email_unverified', ctx);
      return { outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.FAILED };
    }

    let user: User;
    try {
      user = await this.provisioningService.provisionOrganizationForOAuthSignup({
        normalizedEmail: email,
        displayName: identity.displayName ?? null,
        avatarUrl: identity.avatarUrl ?? null,
        provider: identity.provider,
        providerAccountId: identity.subject,
      });
    } catch (error) {
      // The email pre-check above is best-effort: a concurrent signup, or a
      // soft-deleted user still holding the address, races past it into the
      // User.email unique constraint (mirrors RegisterService). A slug
      // collision is an internal error and is rethrown, not mislabeled.
      if (isPrismaUniqueConstraintError(error)) {
        const target = uniqueConstraintTargetText(error);
        if (target === undefined || target.includes('email') || target.includes('provider')) {
          await this.auditFailure(identity, 'account_exists', ctx);
          return { outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.ACCOUNT_EXISTS };
        }
      }
      throw error;
    }

    // Brand-new account: nothing earlier to fence (mirrors register, which
    // omits the epoch entirely). Read it here so every resolution arm hands
    // the seam an explicit value and the capture point stays in this service.
    const epoch = await this.sessionService.readEpoch(user.id);

    await this.auditService.log({
      action: AUDIT_ACTIONS.OAUTH_SIGNUP,
      userId: user.id,
      // Signup runs pre-ALS; without the explicit id the row would stamp null.
      tenantId: user.tenantId,
      targetType: 'User',
      targetId: user.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { provider: identity.provider, providerAccountId: identity.subject },
    });

    return {
      outcome: 'authenticated',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
        tenantId: user.tenantId,
      },
      epoch,
    };
  }

  /**
   * Link completion for a settings-initiated flow (SPEC section 8). The
   * caller (controller) has already validated the CURRENT session at callback
   * time; this method enforces the two identity checks:
   *
   *   - the session user must be the user the flow was pinned to at /start
   *     (a different browser tab logging into another account mid-flow must
   *     not link the identity to whoever is signed in now);
   *   - `(provider, sub)` must not already belong to a DIFFERENT user.
   *
   * A row already linked to the SAME user is an idempotent success (no
   * duplicate row, no duplicate tripwire). No session is minted here: the
   * session that started the flow is the session that finishes it.
   */
  async completeLink(
    identity: IOAuthIdentity,
    flowUserId: string | undefined,
    sessionUserId: string,
    ctx: IOAuthRequestContext,
  ): Promise<{ outcome: 'linked' } | { outcome: 'rejected'; errorCode: OAuthErrorCode }> {
    const email = this.userService.normalizeEmail(identity.email);

    if (flowUserId === undefined || flowUserId !== sessionUserId) {
      await this.auditFailure(identity, 'link_session_mismatch', ctx);
      return { outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.FAILED };
    }

    const user = await this.prismaService.client.user.findFirst({
      where: { id: sessionUserId, deletedAt: null },
      select: RESOLUTION_USER_SELECT,
    });
    if (!user) {
      await this.auditFailure(identity, 'link_session_mismatch', ctx);
      return { outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.FAILED };
    }

    const existing = await this.prismaService.client.oAuthAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: identity.provider,
          providerAccountId: identity.subject,
        },
      },
      select: { id: true, userId: true },
    });
    if (existing) {
      if (existing.userId === user.id) {
        return { outcome: 'linked' };
      }
      await this.auditFailure(identity, 'sub_linked_elsewhere', ctx, user);
      return { outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.ACCOUNT_EXISTS };
    }

    try {
      await this.prismaService.client.oAuthAccount.create({
        data: {
          provider: identity.provider,
          providerAccountId: identity.subject,
          email,
          emailVerified: identity.emailVerified,
          userId: user.id,
        },
      });
    } catch (error) {
      // Concurrent completion of the same sub: the unique index arbitrates.
      if (isPrismaUniqueConstraintError(error)) {
        await this.auditFailure(identity, 'sub_linked_elsewhere', ctx, user);
        return { outcome: 'rejected', errorCode: OAUTH_ERROR_CODES.ACCOUNT_EXISTS };
      }
      throw error;
    }

    await this.sendLinkTripwire(user.email, identity.provider);
    await this.auditService.log({
      action: AUDIT_ACTIONS.OAUTH_LINK,
      userId: user.id,
      tenantId: user.tenantId,
      targetType: 'User',
      targetId: user.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { provider: identity.provider, providerAccountId: identity.subject, auto: false },
    });

    return { outcome: 'linked' };
  }

  /** The session user's linked sign-in methods, for the Connected Accounts panel. */
  async listAccounts(userId: string): Promise<
    {
      id: string;
      provider: string;
      email: string;
      createdAt: Date;
      lastUsedAt: Date;
    }[]
  > {
    return this.prismaService.client.oAuthAccount.findMany({
      where: { userId },
      select: { id: true, provider: true, email: true, createdAt: true, lastUsedAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Unlink one connected account (sudo-gated by the router). The lockout
   * invariant is enforced INSIDE the transaction that deletes the row: the
   * user must keep at least one credential (a password, or another linked
   * account), and two concurrent unlinks must not race each other past the
   * check. The audit row is written after the commit, so a rolled-back unlink
   * never leaves a phantom trail.
   */
  async unlink(userId: string, accountId: string, ctx: IOAuthRequestContext): Promise<void> {
    const removed = await this.prismaService.client.$transaction(async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { passwordHash: true },
      });
      if (!user) {
        throw new UnauthorizedError(AppErrorCode.UNAUTHORIZED, 'Session is no longer valid');
      }
      const accounts = await tx.oAuthAccount.findMany({
        where: { userId },
        select: { id: true, provider: true, providerAccountId: true },
      });
      const target = accounts.find((account) => account.id === accountId);
      if (!target) {
        // Scoped to the session user by construction: someone else's account
        // id is indistinguishable from a nonexistent one.
        throw new NotFoundError(AppErrorCode.NOT_FOUND, 'Connected account not found');
      }
      if (user.passwordHash === null && accounts.length <= 1) {
        // The last sign-in method of a passwordless account: removing it
        // would lock the user out permanently. Same appCode the sudo gate
        // uses, and the same remedy: password reset doubles as set-password.
        throw new ValidationError(
          AppErrorCode.PASSWORD_NOT_SET,
          'Set a password before unlinking your only sign-in method.',
        );
      }
      await tx.oAuthAccount.delete({ where: { id: target.id } });
      return target;
    });

    await this.auditService.log({
      action: AUDIT_ACTIONS.OAUTH_UNLINK,
      userId,
      targetType: 'User',
      targetId: userId,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { provider: removed.provider, providerAccountId: removed.providerAccountId },
    });
  }

  /**
   * `oauth.failure` audit row: provider + reason, explicit
   * tenantId when a user is known, never anything token-shaped. Public because
   * the controller owns the failures that happen before resolution starts
   * (state expiry, bind mismatch, exchange errors).
   */
  async auditFailure(
    identity: { provider: string; subject?: string },
    reason: string,
    ctx: IOAuthRequestContext,
    user?: { id: string; tenantId: string | null },
  ): Promise<void> {
    await this.auditService.log({
      action: AUDIT_ACTIONS.OAUTH_FAILURE,
      success: false,
      ...(user ? { userId: user.id, tenantId: user.tenantId, targetId: user.id } : {}),
      targetType: 'User',
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: {
        provider: identity.provider,
        ...(identity.subject === undefined ? {} : { providerAccountId: identity.subject }),
        reason,
      },
    });
  }

  /**
   * The tripwire notification: every new sign-in method emails the
   * account, so a silently-linked identity cannot stay silent. Enqueue-only
   * and best-effort: a mail outage must not fail the link itself.
   */
  private async sendLinkTripwire(userEmail: string, providerKey: string): Promise<void> {
    try {
      await this.mailService.sendOAuthAccountLinkedEmail(
        userEmail,
        oauthProviderLabel(providerKey),
      );
    } catch (error) {
      this.logger.error('Failed to enqueue oauth-account-linked email', error);
    }
  }

  /**
   * Whether the account has a password, without loading the hash: this flow
   * never verifies a password, so the credential stays out of process memory
   * (see RESOLUTION_USER_SELECT).
   */
  private async hasPassword(userId: string): Promise<boolean> {
    const count = await this.prismaService.client.user.count({
      where: { id: userId, deletedAt: null, passwordHash: { not: null } },
    });
    return count > 0;
  }

  private async findResolutionUserByEmail(email: string): Promise<IResolutionUser | null> {
    // Direct query rather than UserService.findByEmail: the profile-shaped
    // finder omits tenantId (which the session + audit stamping need) and this
    // flow must also see the gate fields. Soft-deleted users are excluded like
    // every user read; their email then falls through to the signup branch and
    // is stopped by the unique constraint (same net behavior as register).
    return this.prismaService.client.user.findFirst({
      where: { email, deletedAt: null },
      select: RESOLUTION_USER_SELECT,
    });
  }

  private toChallengeUser(user: IResolutionUser): IChallengeUser {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerified,
      tenantId: user.tenantId,
    };
  }
}
