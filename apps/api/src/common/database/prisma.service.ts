import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import type { PrismaClient } from '@repo/database' with { 'resolution-mode': 'import' };
import { esmImport } from '../utils/esm-import';

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
  private base!: PrismaClient;

  /** The shared Prisma client (with the slow-query extension from @repo/database). */
  get client(): PrismaClient {
    return this.base;
  }

  async onModuleInit() {
    this.base = await getPrisma();
    // Verify database connectivity on startup.
    await this.base.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy() {
    if (this.base) {
      await this.base.$disconnect();
    }
  }
}
