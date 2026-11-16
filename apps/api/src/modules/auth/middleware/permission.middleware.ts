import { Inject, Injectable } from '@nestjs/common';
import { TRPCMiddleware, MiddlewareOptions, MiddlewareResponse } from 'nestjs-trpc';
import { z } from 'zod';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { RedisKeys } from '../../../common/redis/redis-keys';
import { PrismaService } from '../../../common/database/prisma.service';
import type { IAppContextType } from '../../../trpc/trpc.context';
import { ForbiddenError, UnauthorizedError } from '../../../common/errors';
import { PERMISSIONS, type Permission, type Role } from '@repo/shared/permissions';
import { AppErrorCode } from '@repo/shared/errors';

const PERMISSIONS_CACHE_TTL = 300; // 5 minutes

/** Shape of the Redis-cached permission list. Validated on read so a corrupt
 * or legacy entry rebuilds from the DB rather than granting wrong permissions. */
const permissionsCacheSchema = z.array(z.string());

/**
 * Base class for permission-checking middleware.
 * Uses Redis-cached permissions with 5-minute TTL.
 * Subclass and set `requiredPermission` for concrete middleware.
 */
@Injectable()
export abstract class PermissionMiddleware implements TRPCMiddleware {
  protected abstract readonly requiredPermission: Permission;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prismaService: PrismaService,
  ) {}

  async use(opts: MiddlewareOptions): Promise<Awaited<MiddlewareResponse>> {
    const { ctx, next } = opts;
    const user = (ctx as IAppContextType).user;

    if (!user) {
      throw new UnauthorizedError(AppErrorCode.UNAUTHORIZED, 'Not authenticated');
    }

    const permissions = await this.getUserPermissions(user.id, user.role);

    if (!permissions.includes(this.requiredPermission)) {
      throw new ForbiddenError(
        AppErrorCode.FORBIDDEN,
        `Missing permission: ${this.requiredPermission}`,
      );
    }

    return next();
  }

  private async getUserPermissions(userId: string, role: string): Promise<string[]> {
    // Key the cache by role: a still-valid session on a since-changed role must
    // not read (or repoison) the entry the user's current role reads.
    const cacheKey = RedisKeys.permissions(userId, role);

    // Check Redis cache first. Validate the parsed value: a corrupt or legacy
    // entry must not silently become a permission set.
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return permissionsCacheSchema.parse(JSON.parse(cached));
      } catch {
        // Fall through and rebuild from the DB (source of truth) below.
      }
    }

    // Cache miss: query Prisma for role-based permissions + user-specific overrides
    const rolePermissions = await this.prismaService.client.rolePermission.findMany({
      where: {
        OR: [
          { role: role as Role, userId: null }, // Role-level permissions
          { userId }, // User-specific permission overrides
        ],
      },
      select: { permission: { select: { name: true } } },
    });

    const permissionNames = rolePermissions.map(
      (rp: { permission: { name: string } }) => rp.permission.name,
    );
    const permissions = Array.from(new Set<string>(permissionNames));

    // Cache in Redis with TTL
    await this.redis.setex(cacheKey, PERMISSIONS_CACHE_TTL, JSON.stringify(permissions));

    return permissions;
  }
}

/**
 * Concrete middleware requiring the 'manage_users' permission.
 * Must be used after AuthMiddleware.
 */
@Injectable()
export class ManageUsersMiddleware extends PermissionMiddleware {
  protected readonly requiredPermission: Permission = PERMISSIONS.MANAGE_USERS;
}
