import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { ForbiddenError, UnauthorizedError } from '../../../common/errors';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { LockoutService } from './lockout.service';
import { AuthSharedService } from './auth-shared.service';
import { UserService, type IUserProfile } from '../../user/user.service';
import { EventsService } from '../../events/events.service';
import { SessionRevocationService } from '../../events/session-revocation.service';
import { CsrfService } from '../../../common/security/csrf.service';
import { AuditService } from '../../audit/audit.service';
import { TwoFactorChallengeService, type ILoginResult } from './two-factor-challenge.service';
import { recordAuthOutcome } from '../../metrics/auth-outcome.recorder';

// Re-exported for existing importers; the canonical definition (a discriminated
// union on `status`) lives with the challenge seam that produces both arms.
export type { ILoginResult } from './two-factor-challenge.service';

/**
 * Argon2id hash of an arbitrary throwaway string, generated with the exact
 * PasswordService parameters (ARGON2_OPTIONS in password.service.ts). Used
 * ONLY to equalize timing on the unknown-email branch: without it, "email not
 * found" returns in microseconds while "wrong password" pays a full argon2
 * verify, an account-enumeration timing oracle. It never verifies a real
 * credential and the result is always discarded.
 *
 * If ARGON2_OPTIONS changes, regenerate this string with the new parameters;
 * login.service.spec.ts fails when the encoded m/t/p drift from the options.
 */
export const TIMING_EQUALIZATION_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$TL7FbHPu4DMevZuU/4CxJQ$Pq3M6yMD+FMAhJT8tQbgp/LzPyCJyItXKWUKShImdf0';

@Injectable()
export class LoginService {
  constructor(
    private readonly passwordService: PasswordService,
    private readonly sessionService: SessionService,
    private readonly lockoutService: LockoutService,
    private readonly userService: UserService,
    private readonly sessionRevocation: SessionRevocationService,
    private readonly eventsService: EventsService,
    private readonly csrfService: CsrfService,
    private readonly auditService: AuditService,
    private readonly shared: AuthSharedService,
    private readonly twoFactorChallenge: TwoFactorChallengeService,
  ) {}

  /**
   * Log in with email/password.
   * Validates credentials, checks lockout, creates session.
   */
  async login(
    input: {
      email: string;
      password: string;
      rememberMe: boolean;
      turnstileToken: string;
    },
    ip: string,
    userAgent: string,
    req: Request,
    res: Response,
  ): Promise<ILoginResult> {
    await this.shared.enforceAuthRateLimit('login', ip);
    await this.shared.validateTurnstile(input.turnstileToken, ip);

    // Find user (generic error per OWASP). The credential finder carries
    // passwordHash, which the verify step below needs; the default findByEmail
    // omits it.
    const user = await this.userService.findCredentialByEmail(input.email);
    if (!user) {
      // Burn the same argon2 verify cost a known email pays, so the response
      // time does not reveal whether the email exists. Result ignored.
      await this.passwordService.verify(TIMING_EQUALIZATION_HASH, input.password);
      await this.auditService.log({
        action: AUDIT_ACTIONS.AUTH_LOGIN_FAILURE,
        targetType: 'User',
        success: false,
        ipAddress: ip,
        userAgent,
        metadata: { reason: 'unknown_email' },
      });
      /*
       * No userId: resolving one is exactly what did not happen, and the
       * account-enumeration defense is why.
       *
       * INVALID_CREDENTIALS rather than the generic UNAUTHORIZED, and all three
       * refusals below use it too. The code is what the web renders copy from
       * now that `translateAppError` prefers the catalog over the server's
       * English sentence, and UNAUTHORIZED reads "Sign in to perform this
       * action.", which is what the person is already trying to do. It leaks
       * nothing: unknown email, wrong password and ended membership are all
       * answered with this one code and one message, which is the whole point.
       */
      recordAuthOutcome({ flow: 'login', outcome: 'unknown_email', kind: 'refusal' });
      throw new UnauthorizedError(AppErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');
    }

    // Capture the session-epoch fence NOW, before the password is verified. The
    // value has to be read after the credential row (the counter is keyed by
    // user id, which the email lookup is what produces) but before anything
    // slow: a password change commits its new hash and only then bumps the
    // counter, so a login that read the OLD hash necessarily read the OLD
    // counter too, and the mint is refused. Capturing it later, inside
    // createSession, say, would leave the entire argon2 verify below as a
    // window in which a login using the just-changed password still wins.
    const epoch = await this.sessionService.readEpoch(user.id);

    // Check lockout from the row already in hand: the credential fetch above
    // loads lockedUntil, so re-reading it via isLocked(user.id) would double
    // the query on the login hot path.
    const lockStatus = this.lockoutService.isLockedFromUser(user);
    if (lockStatus.locked) {
      await this.refuseLocked(user, ip, userAgent, 'locked');
    }

    // The admission gate, BEFORE argon2. The check above reads `lockedUntil`
    // off the row THIS request fetched, so every request that started before
    // the fifth failure committed passes it and gets a full password
    // evaluation, whatever the budget says. Reserving the attempt atomically
    // first is what makes the 5-attempt bound hold under a parallel burst; see
    // LockoutService.reserveAttempt.
    //
    // Reserved AFTER the lock check, so an account that is already locked never
    // inflates its own counter, and refused through the SAME ACCOUNT_LOCKED
    // path, so an over-budget attempt is indistinguishable from a real lockout
    // on the wire. It also runs before the passwordHash is looked at, so a
    // Google-only account reserves exactly like a password account and the
    // burst cannot be used to tell the two apart.
    const reservation = await this.lockoutService.reserveAttempt(user.id);
    if (!reservation.withinBudget) {
      await this.refuseLocked(user, ip, userAgent, 'attempt_budget');
    }

    // Verify password. An OAuth-only account (passwordHash null) has no
    // password to verify: it can never authenticate here, and it must be
    // INDISTINGUISHABLE from a wrong password, or this endpoint becomes an
    // oracle for which accounts sign in with Google. So the null branch burns
    // the same argon2 cost, then falls into the identical failure path below:
    // same error, same lockout accounting, same response time. The dummy
    // verify's result is DISCARDED rather than assigned, so even a preimage of
    // the (publicly visible) TIMING_EQUALIZATION_HASH could not authenticate.
    let passwordValid: boolean;
    let failureReason = 'bad_password';
    if (user.passwordHash === null) {
      await this.passwordService.verify(TIMING_EQUALIZATION_HASH, input.password);
      passwordValid = false;
      // Server-side only (audit rows are never returned to the client), so
      // operators can tell a real typo from a Google-only user at the password
      // form without the client learning anything.
      failureReason = 'no_password_set';
    } else {
      passwordValid = await this.passwordService.verify(user.passwordHash, input.password);
    }
    if (!passwordValid) {
      await this.lockoutService.recordFailedAttempt(user.id);
      await this.auditService.log({
        action: AUDIT_ACTIONS.AUTH_LOGIN_FAILURE,
        userId: user.id,
        tenantId: user.tenantId,
        targetType: 'User',
        targetId: user.id,
        success: false,
        ipAddress: ip,
        userAgent,
        metadata: { reason: failureReason },
      });
      recordAuthOutcome({
        flow: 'login',
        outcome: failureReason,
        kind: 'refusal',
        userId: user.id,
      });
      throw new UnauthorizedError(AppErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');
    }

    // Reset failed attempts on successful login
    await this.lockoutService.resetAttempts(user.id);

    // The membership fence: somebody removed from their organization keeps
    // their account and their address, and must not be able to sign in with it.
    //
    // Enforced HERE and not in auth.middleware, which reads the session blob
    // and never touches the database: putting it there would add a per-request
    // DB read to the hottest path in the app. The sessions a removed member
    // already holds are closed by revokeAuthState at removal time, so this is
    // the door for new ones, not a catch-up. The seam below re-reads the flag
    // right before it mints anything (a removal racing this login, or a door
    // that forgets the check); this refusal stays for its accurate audit row.
    //
    // AFTER the credential check, deliberately. A removal must
    // be indistinguishable from a wrong password to somebody who does not hold
    // the password, or this becomes an oracle for who has left which organization.
    if (user.membershipEndedAt !== null) {
      await this.auditService.log({
        action: AUDIT_ACTIONS.AUTH_LOGIN_FAILURE,
        userId: user.id,
        tenantId: user.tenantId,
        targetType: 'User',
        targetId: user.id,
        success: false,
        ipAddress: ip,
        userAgent,
        metadata: { reason: 'membership_ended' },
      });
      recordAuthOutcome({
        flow: 'login',
        outcome: 'membership_ended',
        kind: 'refusal',
        userId: user.id,
      });
      throw new UnauthorizedError(AppErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');
    }

    // Delegate the post-credential decision to the shared 2FA seam: it either
    // establishes the session (no active factor, or a valid trusted device) or
    // mints a pending record and returns a challenge. The session cookie and
    // CSRF rotation move INTO the seam, so the auth state now changes exactly
    // where the second factor is satisfied instead of at password verify.
    const outcome = await this.twoFactorChallenge.beginOrEstablish(
      req,
      res,
      {
        id: user.id,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
        tenantId: user.tenantId,
      },
      { rememberMe: input.rememberMe, ip, userAgent, epoch },
    );

    if (outcome.kind === 'challenge') {
      // Half logged in: the pending cookie is set and the SPA now calls
      // auth.verifyTwoFactor. No login-success audit yet; it fires when the
      // factor is verified (AUTH_2FA_CHALLENGE_SUCCESS).
      recordAuthOutcome({
        flow: 'login',
        outcome: 'twofa_required',
        kind: 'success',
        userId: user.id,
      });
      return { status: 'twofa_required', methods: outcome.methods };
    }

    // A session was established directly. Emit login-success only for a pure
    // no-factor login; a trusted-device short-circuit is a 2FA event the seam
    // already audited as a challenge success.
    if (outcome.via === 'no_factor') {
      await this.auditService.log({
        action: AUDIT_ACTIONS.AUTH_LOGIN_SUCCESS,
        userId: user.id,
        tenantId: user.tenantId,
        targetType: 'User',
        targetId: user.id,
        ipAddress: ip,
        userAgent,
        metadata: { rememberMe: input.rememberMe },
      });
    }
    // Counted for both arms: a trusted-device short-circuit is still a
    // completed login, it is just audited as a 2FA event rather than a
    // login-success row.
    recordAuthOutcome({
      flow: 'login',
      outcome: outcome.via === 'no_factor' ? 'success' : 'success_trusted_device',
      kind: 'success',
      userId: user.id,
    });

    // Build the profile from the credential row already in hand (a superset of
    // the getProfile projection), projecting explicitly so credential fields
    // (passwordHash, lockout counters) cannot leak into the response.
    const profile: IUserProfile = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      role: user.role,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
    };
    return { status: 'ok', user: profile, requiresVerification: !user.emailVerified };
  }

  /**
   * The one ACCOUNT_LOCKED refusal: audit row, metric, throw. Shared by the
   * `lockedUntil` check and the Redis admission gate so the two are the same
   * response, which is the point: an attempt refused for being over budget
   * must not be distinguishable from one refused by the row.
   *
   * `reason` separates them server-side only (audit rows never reach the
   * client), so an operator can tell a burst from an ordinary lockout.
   *
   * Returns `never`: every caller throws through it.
   */
  private async refuseLocked(
    user: { id: string; tenantId: string | null },
    ip: string,
    userAgent: string,
    reason: 'locked' | 'attempt_budget',
  ): Promise<never> {
    await this.auditService.log({
      action: AUDIT_ACTIONS.AUTH_LOGIN_LOCKED,
      userId: user.id,
      // Stamped explicitly: this write runs BEFORE AuthMiddleware seeds the
      // ALS, so the tenant would otherwise be null and the row would follow
      // the account into whatever organization it later joins (audit-read.repository
      // attributes tenant-less rows through the actor's CURRENT tenant). A
      // login failure belongs to the organization it happened in.
      tenantId: user.tenantId,
      targetType: 'User',
      targetId: user.id,
      success: false,
      ipAddress: ip,
      userAgent,
      metadata: { reason },
    });
    recordAuthOutcome({
      flow: 'login',
      outcome: reason === 'locked' ? 'locked' : 'attempt_budget',
      kind: 'refusal',
      userId: user.id,
    });
    throw new ForbiddenError(AppErrorCode.ACCOUNT_LOCKED);
  }

  /**
   * Log out current session.
   *
   * Deleting the session blob is not the whole logout: a socket authenticated
   * at handshake is never re-checked, so before the gateway had per-session
   * rooms a logged-out tab (or any client that does not close its own socket)
   * kept receiving this tenant's notifications until it happened to reconnect.
   * On a shared office computer that is the difference between "I logged out"
   * and the stream actually stopping. Dropping only THIS session's sockets, so
   * the person's other devices stay connected.
   */
  async logout(sessionToken: string, req: Request, res: Response): Promise<void> {
    const sessionId = await this.sessionService.deleteSession(sessionToken);
    this.eventsService.disconnectSession(sessionId);
    this.shared.clearSessionCookie(res);
    this.csrfService.rotate(req, res);
    await this.auditService.log({ action: AUDIT_ACTIONS.AUTH_LOGOUT });
  }

  /**
   * Log out all sessions for a user.
   */
  async logoutAll(userId: string, req: Request, res: Response): Promise<void> {
    // Live sockets keep their identity until reconnect, so a "log out all
    // devices" also drops the websocket connections (one shared step).
    await this.sessionRevocation.revokeAllAndDisconnect(userId);
    this.shared.clearSessionCookie(res);
    this.csrfService.rotate(req, res);
    await this.auditService.log({
      action: AUDIT_ACTIONS.AUTH_LOGOUT_ALL,
      userId,
      targetType: 'User',
      targetId: userId,
    });
  }
}
