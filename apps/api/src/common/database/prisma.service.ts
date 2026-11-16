import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import type { PrismaClient } from '@repo/database' with { 'resolution-mode': 'import' };
import { esmImport } from '../utils/esm-import';
import { buildTenantScopeExtension } from './tenant-scope.extension';

let prismaInstance: PrismaClient | undefined;

async function getPrisma(): Promise<PrismaClient> {
  if (!prismaInstance) {
    const { prisma } = (await esmImport('@repo/database')) as {
      prisma: PrismaClient;
    };
    prismaInstance = prisma;
  }
  return prismaInstance;
}

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  /** Raw base client (slow-query extension only, NOT tenant-scoped). */
  private base!: PrismaClient;
  /** Tenant-scoped extended client built once in onModuleInit. */
  private scoped!: PrismaClient;

  /**
   * Tenant-scoped client: every tenant-scoped model is filtered by the active
   * `tenantId` from the ALS request context, and fails closed when no tenant
   * is in context. This is the default for request handlers - reach for it
   * unless you have a documented reason to escape the boundary.
   */
  get client(): PrismaClient {
    return this.scoped;
  }

  /**
   * Raw, UNSCOPED client - no tenant filtering. For seeds, migrations, system
   * jobs, and tests only. Using this in a request handler defeats the only
   * isolation boundary in the app, so it is allowlisted and lint-guarded.
   */
  get unscoped(): PrismaClient {
    return this.base;
  }

  async onModuleInit() {
    this.base = await getPrisma();
    // Build the scoped client ONCE: `$extends` mints a new proxy per call, so
    // doing it in the getter would churn proxies on every access.
    this.scoped = this.base.$extends(buildTenantScopeExtension()) as unknown as PrismaClient;
    // Verify database connectivity on startup (base client, no tenant context).
    await this.base.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy() {
    if (this.base) {
      await this.base.$disconnect();
    }
  }
}
