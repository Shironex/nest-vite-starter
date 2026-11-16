/**
 * `pnpm --filter @repo/api user:promote <email>`: make an existing account an
 * ADMIN. See promote-user.ts for what it does and refuses.
 *
 * A standalone script rather than a Nest application context: it needs three
 * collaborators, so it builds them by hand instead of booting the whole module
 * graph (queues, schedulers, the HTTP stack) for one write.
 *
 * Reads the same env files as the api (`./load-env` first, for the same
 * reason `main.ts` imports it first), so it targets whatever database and
 * Redis `pnpm dev` would.
 */
import '../load-env';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { PrismaClient } from '@repo/database' with { 'resolution-mode': 'import' };
import { esmImport } from '../common/utils/esm-import';
import type { PrismaService } from '../common/database/prisma.service';
import { UserRepository } from '../modules/user/user.repository';
import { SessionService } from '../modules/auth/services/session.service';
import { AuditService } from '../modules/audit/audit.service';
import { promoteUser } from './promote-user';

const USAGE = 'Usage: pnpm --filter @repo/api user:promote <email>\n';

async function main(): Promise<number> {
  const email = process.argv[2];
  if (email === undefined || email.trim() === '') {
    process.stderr.write(USAGE);
    return 2;
  }
  // A bare ConfigService reads straight from the environment the env files
  // above populated; no module graph is booted for it.
  const redisUrl = new ConfigService().get<string>('REDIS_URL');
  if (redisUrl === undefined || redisUrl === '') {
    process.stderr.write('REDIS_URL is not set; the sessions of the account cannot be revoked.\n');
    return 1;
  }

  const { prisma } = (await esmImport('@repo/database')) as { prisma: PrismaClient };
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  const prismaService = { client: prisma } as unknown as PrismaService;

  try {
    const result = await promoteUser(email, {
      users: new UserRepository(prismaService),
      sessions: new SessionService(redis),
      audit: new AuditService(prismaService),
    });
    process.stdout.write(
      result.outcome === 'promoted'
        ? `${result.email} is now an ADMIN. Their sessions were revoked; the role applies at their next sign-in.\n`
        : `${result.email} is already an ADMIN. Nothing changed.\n`,
    );
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  } finally {
    await prisma.$disconnect();
    redis.disconnect();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
