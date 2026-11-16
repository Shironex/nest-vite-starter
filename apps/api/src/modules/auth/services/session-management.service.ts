import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppErrorCode } from '@repo/shared/errors';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import type { ActiveSessionsOutput } from '@repo/shared/schemas';
import { UnauthorizedError } from '../../../common/errors';
import { sha256Hex } from '../../../common/utils/crypto';
import { SessionService } from './session.service';
import { AuthSharedService } from './auth-shared.service';
import { SessionRevocationService } from '../../events/session-revocation.service';
import { EventsService } from '../../events/events.service';
import { AuditService } from '../../audit/audit.service';

/**
 * The self-service active-sessions surface: list the caller's own devices,
 * sign one of them out, or sign everything else out. Strictly self-scoped:
 * every method takes the CALLER's identity from their own session; admin-side
 * session management is deliberately not here.
 *
 * The wire never carries the server-side session id (the Redis key id, a
 * sha256 of the cookie token). Rows are addressed by `publicSessionId`, a
 * second hash of that id: stable per session (a React key and a revoke handle
 * that survive refetches) but useless for naming a Redis key. Revoke resolves
 * it back by re-deriving over the caller's own list, which also makes cross-
 * user targeting structurally impossible: a foreign handle simply never
 * matches.
 */
@Injectable()
export class SessionManagementService {
  constructor(
    private readonly sessionService: SessionService,
    private readonly sessionRevocation: SessionRevocationService,
    private readonly eventsService: EventsService,
    private readonly auditService: AuditService,
    private readonly shared: AuthSharedService,
  ) {}

  /** The opaque wire handle for a session (see the class doc). */
  private publicSessionId(sessionId: string): string {
    return sha256Hex(sessionId);
  }

  /**
   * The caller's active sessions, current one first, then newest activity
   * first. Sorted here so every client shows the same order and the "this
   * device" row is always on top without client-side re-sorting.
   */
  async listSessions(userId: string, currentSessionId: string): Promise<ActiveSessionsOutput> {
    const sessions = await this.sessionService.getUserSessions(userId);
    return sessions
      .map((session) => ({
        id: this.publicSessionId(session.sessionId),
        ip: session.ip,
        userAgent: session.userAgent,
        createdAt: session.createdAt,
        lastActive: session.lastActive,
        isCurrent: session.sessionId === currentSessionId,
      }))
      .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || b.lastActive - a.lastActive);
  }

  /**
   * Revoke one of the caller's sessions by its public handle. Idempotent: a
   * handle that no longer resolves (revoked in another tab, expired, or not
   * the caller's at all) is already the desired end state, so it acks rather
   * than errors and the list refetch tells the rest of the story.
   *
   * Only the revoked session's sockets are dropped. This used to close every
   * socket the user had, because the gateway had no per-session disconnect and
   * "reconnect and re-authenticate" was the nearest available behavior; it
   * meant signing one device out flickered every other device. The gateway now
   * joins `session:<id>` at handshake, so the revoke targets exactly the
   * session it names. Same revoke-then-disconnect pairing every other
   * revocation flow uses.
   */
  async revokeSession(
    userId: string,
    publicId: string,
    requestMeta: { ip: string; userAgent: string },
  ): Promise<void> {
    const sessions = await this.sessionService.getUserSessions(userId);
    const target = sessions.find((session) => this.publicSessionId(session.sessionId) === publicId);
    if (!target) {
      return;
    }

    const deleted = await this.sessionService.deleteUserSessionById(userId, target.sessionId);
    if (!deleted) {
      return;
    }

    this.eventsService.disconnectSession(target.sessionId);
    await this.auditService.log({
      action: AUDIT_ACTIONS.AUTH_SESSION_REVOKED,
      userId,
      targetType: 'User',
      targetId: userId,
      ipAddress: requestMeta.ip,
      userAgent: requestMeta.userAgent,
      // The public handle is already client-visible; the server-side session
      // id never leaves the service.
      metadata: { sessionRef: publicId },
    });
  }

  /**
   * "Log out everywhere else": revoke EVERY session via the one epoch-bumping
   * path (deleteAllUserSessions, whose fence makes the revocation immediate
   * even for sessions the walk could not see), then immediately re-issue the
   * caller's session: the exact password-change pattern, minus the password.
   *
   * The replacement is minted from the CURRENT session blob rather than a
   * fresh user-row read: the blob is what this very request was authenticated
   * against, and every field it carries (role, tenant, the enrollment gate)
   * is revoked-on-change, so it cannot be staler than the request itself.
   * Remember-me is preserved so "log out other devices" does not silently
   * shorten the caller's own 30-day login to 24 hours.
   *
   * Deliberately passes NO epoch to establishSession, so the mint reads the
   * counter this flow just bumped; capturing one earlier would fence the
   * replacement session out the moment it was written.
   */
  async revokeOtherSessions(
    sessionToken: string,
    ip: string,
    userAgent: string,
    req: Request,
    res: Response,
  ): Promise<void> {
    const current = await this.sessionService.validateSession(sessionToken);
    if (!current) {
      // Revoked between the middleware's validate and this one (another tab's
      // password change, an admin action). Fail closed as a plain re-login.
      throw new UnauthorizedError(
        AppErrorCode.SESSION_EXPIRED,
        'Your session expired, please log in again',
      );
    }

    const rememberMe = this.sessionService.isRememberMeSession(current);
    await this.sessionRevocation.revokeAllAndDisconnect(current.userId);

    await this.shared.establishSession(req, res, {
      userId: current.userId,
      email: current.email,
      role: current.role,
      emailVerified: current.emailVerified,
      ip,
      userAgent,
      rememberMe,
      tenantId: current.tenantId,
      // Carried forward defensively: an enrollment-gated session cannot reach
      // this procedure today, but if the middleware allowlist ever grows,
      // dropping the flag here would silently ungate the account.
      twoFactorEnrollmentRequired: current.twoFactorEnrollmentRequired,
    });

    await this.auditService.log({
      action: AUDIT_ACTIONS.AUTH_LOGOUT_OTHERS,
      userId: current.userId,
      targetType: 'User',
      targetId: current.userId,
      ipAddress: ip,
      userAgent,
    });
  }
}
