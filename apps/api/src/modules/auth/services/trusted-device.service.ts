import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type Redis from 'ioredis';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { RedisKeys } from '../../../common/redis/redis-keys';
import { sha256Hex } from '../../../common/utils/crypto';
import { nowMs } from '../../../common/clock';
import {
  TOKEN_ENTROPY_BYTES,
  TRUSTED_DEVICE_CAP,
  TRUSTED_DEVICE_TTL_SECONDS,
  getTrustedDeviceCookieName,
} from '../auth.constants';
import { AuthSharedService } from './auth-shared.service';

const trustedDeviceSchema = z.object({
  userId: z.string(),
  createdAt: z.number(),
  ip: z.string(),
  userAgent: z.string(),
});
type TrustedDevice = z.infer<typeof trustedDeviceSchema>;

/**
 * "Remember this browser": an opaque Redis-backed token mirroring the session
 * pattern (revocable, unlike a signed stateless cookie). A valid token lets a
 * subsequent login skip the 2FA challenge, but ONLY when its stored userId
 * matches the authenticating user: a browser trusted for user A must never
 * skip user B's challenge on the same machine. Fixed 30-day lifetime (no sliding
 * renewal), capped at 5 per user oldest-first.
 */
@Injectable()
export class TrustedDeviceService {
  private readonly cookieName: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly shared: AuthSharedService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.cookieName = getTrustedDeviceCookieName(
      this.configService.get<string>('NODE_ENV') === 'production',
    );
  }

  /**
   * True only if the request carries a valid trusted-device cookie whose stored
   * blob belongs to `userId`. A missing/corrupt/mismatched record falls through
   * to the challenge (never an error).
   */
  async isTrusted(req: Request, userId: string): Promise<boolean> {
    const token = req.cookies?.[this.cookieName] as string | undefined;
    if (!token) {
      return false;
    }
    const raw = await this.redis.get(RedisKeys.trustedDevice(sha256Hex(token)));
    const blob = raw ? this.parse(raw) : null;
    return blob !== null && blob.userId === userId;
  }

  /** Mint a trusted-device record + cookie, then enforce the oldest-first cap. */
  async trust(
    req: Request,
    res: Response,
    userId: string,
    ip: string,
    userAgent: string,
  ): Promise<void> {
    const token = randomBytes(TOKEN_ENTROPY_BYTES).toString('hex');
    const deviceId = sha256Hex(token);
    const blob: TrustedDevice = { userId, createdAt: nowMs(), ip, userAgent };
    // SADD-first discipline (like user_sessions) so a crash cannot leave a record
    // the revocation walk can never find.
    await this.redis
      .multi()
      .sadd(RedisKeys.trustedDevices(userId), deviceId)
      .expire(RedisKeys.trustedDevices(userId), TRUSTED_DEVICE_TTL_SECONDS)
      .setex(RedisKeys.trustedDevice(deviceId), TRUSTED_DEVICE_TTL_SECONDS, JSON.stringify(blob))
      .exec();
    await this.enforceCap(userId);
    this.shared.setAuthCookie(res, this.cookieName, token, TRUSTED_DEVICE_TTL_SECONDS * 1000);
  }

  /** Number of trusted devices for the settings card. */
  count(userId: string): Promise<number> {
    return this.redis.scard(RedisKeys.trustedDevices(userId));
  }

  /**
   * Revoke ALL trusted devices for a user (SET walk + blob DEL). Called on 2FA
   * disable, admin/support reset, password change, and password reset.
   */
  async revokeAll(userId: string): Promise<void> {
    const ids = await this.redis.smembers(RedisKeys.trustedDevices(userId));
    const multi = this.redis.multi();
    for (const id of ids) {
      multi.del(RedisKeys.trustedDevice(id));
    }
    multi.del(RedisKeys.trustedDevices(userId));
    await multi.exec();
  }

  /** Evict the oldest devices beyond the cap (mirrors max-session eviction). */
  private async enforceCap(userId: string): Promise<void> {
    const ids = await this.redis.smembers(RedisKeys.trustedDevices(userId));
    if (ids.length <= TRUSTED_DEVICE_CAP) {
      return;
    }
    const blobs = await this.redis.mget(ids.map((id) => RedisKeys.trustedDevice(id)));
    const dated = ids.map((id, i) => {
      const raw = blobs[i];
      const parsed = raw ? this.parse(raw) : null;
      return { id, createdAt: parsed?.createdAt ?? 0 };
    });
    dated.sort((a, b) => a.createdAt - b.createdAt);
    const evict = dated.slice(0, dated.length - TRUSTED_DEVICE_CAP);
    const multi = this.redis.multi();
    for (const { id } of evict) {
      multi.del(RedisKeys.trustedDevice(id));
      multi.srem(RedisKeys.trustedDevices(userId), id);
    }
    await multi.exec();
  }

  private parse(raw: string): TrustedDevice | null {
    try {
      return trustedDeviceSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }
}
