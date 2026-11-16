import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { AppErrorCode } from '@repo/shared/errors';
import { UnauthorizedError, ValidationError } from '../../../common/errors';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { SUDO_TTL_SECONDS, sudoKey } from '../auth.constants';
import { AuthSharedService } from './auth-shared.service';
import { PasswordService } from './password.service';
import { UserService } from '../../user/user.service';

/**
 * Per-user envelope for password confirmation attempts, matching the 2FA
 * management knob (5 / 300 s): sudo IS a password-verify oracle, so it gets
 * the same budget as the other authenticated password gates.
 */
const SUDO_RATE_LIMIT = 5;
const SUDO_RATE_WINDOW_SECONDS = 300;

/**
 * Per-session sudo flag (Google sign-in SPEC section 8).
 *
 * `auth.confirmPassword` verifies the caller's password and marks THIS session
 * as recently-confirmed for {@link SUDO_TTL_SECONDS}; the OAuth link start and
 * the unlink mutation require the mark. Keyed by sessionId, not userId, so a
 * confirmation on one device never elevates a session on another.
 *
 * When the 2FA effort lands its step-up (2FA T03: password + factor challenge
 * when factors exist), that flow extends this same flag; the contract ("the
 * key exists iff this session recently re-proved possession of a credential")
 * does not change, so the consumers here stay untouched.
 */
@Injectable()
export class SudoService {
  constructor(
    private readonly passwordService: PasswordService,
    private readonly userService: UserService,
    private readonly shared: AuthSharedService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Verify the current password and grant sudo to the calling session.
   *
   * Mirrors TwoFactorService.requireSudo exactly: per-USER rate limit (a
   * hijacked session can rotate IPs, so per-IP would not slow it down), fail
   * closed with PASSWORD_NOT_SET for an OAuth-only account (null hash; the
   * web copy points at password reset, which doubles as set-password), and the
   * generic INVALID_CREDENTIALS on a wrong password. Lockout counters are NOT
   * fed: this endpoint is authenticated and self-scoped, and locking the
   * account out of its own settings on typos would be a self-DoS lever.
   */
  async confirmPassword(userId: string, sessionId: string, password: string): Promise<void> {
    await this.shared.enforceRateLimit(`sudo:${userId}`, SUDO_RATE_LIMIT, SUDO_RATE_WINDOW_SECONDS);

    const user = await this.userService.findCredentialById(userId);
    if (!user) {
      throw new UnauthorizedError(AppErrorCode.UNAUTHORIZED, 'Session is no longer valid');
    }
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

    await this.redis.setex(sudoKey(sessionId), SUDO_TTL_SECONDS, '1');
  }

  /** Whether this session holds a live sudo grant. Read-only, never extends the TTL. */
  async isActive(sessionId: string): Promise<boolean> {
    return (await this.redis.get(sudoKey(sessionId))) !== null;
  }
}
