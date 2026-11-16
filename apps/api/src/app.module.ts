import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ScheduleModule } from '@nestjs/schedule';
import { TRPCModule } from 'nestjs-trpc';
import superjson from 'superjson';
import type Redis from 'ioredis';
import { REDIS_CLIENT, RedisModule } from './common/redis/redis.module';
import { validationSchema } from './config/configuration.config';
import { LoggerModule } from './modules/logger/logger.module';
import { CustomLogger } from './modules/logger/logger.service';
import { PrismaModule } from './common/database/prisma.module';
import { AppContext } from './trpc/trpc.context';
import { AppErrorHandler, appErrorFormatter } from './trpc/trpc.error-handler';
import { PingRouter } from './trpc/ping.router';
import { HealthModule } from './modules/health/health.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { MailModule } from './modules/mail/mail.module';
import { SessionModule } from './modules/auth/session.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { DataExportModule } from './modules/data-export/data-export.module';
import { StorageModule } from './modules/storage/storage.module';
import { WorkspaceModule } from './modules/workspace/workspace.module';
import { QueueModule } from './common/queue/queue.module';
import { QueueObservabilityModule } from './common/queue/queue-observability.module';
import { RequestContextModule } from './common/context/request-context.module';
import { AuditModule } from './modules/audit/audit.module';
import { SecurityModule } from './common/security/security.module';
import { TrpcTimingModule } from './common/trpc/trpc-timing.module';
import { TrpcTimingMiddleware } from './common/trpc/trpc-timing.middleware';
import { TrpcRequestContextModule } from './common/trpc/trpc-request-context.module';
import { TrpcRequestContextMiddleware } from './common/trpc/trpc-request-context.middleware';

const envFilePath = '.env';

// Global fallback limit shared across replicas via Redis; sensitive surfaces
// (auth, csrf-token, vitals) layer their own tighter per-route throttles.
const GLOBAL_THROTTLE = { ttl: 60_000, limit: 100 };

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema,
      envFilePath,
    }),
    LoggerModule,
    PrismaModule,
    RedisModule,
    // ThrottlerModule with Redis storage so the limit window is shared
    // across API replicas. Without this, each replica gets its own bucket
    // and the effective limit = configured * replica_count.
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis) => ({
        throttlers: [GLOBAL_THROTTLE],
        storage: new ThrottlerStorageRedisService(redis),
      }),
    }),
    // The one ScheduleModule.forRoot() + the @Cron convention (token cleanup).
    // Every other cron reuses this registration, it does not re-register.
    ScheduleModule.forRoot(),
    QueueModule,
    QueueObservabilityModule,
    RequestContextModule,
    AuditModule,
    SecurityModule,
    TrpcTimingModule,
    TrpcRequestContextModule,
    // nestjs-trpc instantiates its own `new ConsoleLogger()` for the framework
    // bootstrap lines (route mapping, server init). bufferLogs + app.useLogger()
    // in main.ts cannot intercept that concrete instance, so without a logger
    // here those lines print in the default Nest format: non-JSON lines that
    // break the structured-log contract in production. nestjs-trpc has no
    // forRootAsync, so the only way to route them through CustomLogger is a
    // concrete instance. CustomLogger has no constructor deps (it reads ALS via
    // module-level imports), so this standalone instance behaves identically to
    // the DI one for these context-free bootstrap lines. main.ts itself relies on
    // bufferLogs + app.useLogger() and creates no second instance.
    TRPCModule.forRoot({
      context: AppContext,
      onError: AppErrorHandler,
      // Expose the canonical AppErrorCode as error.data.appCode on the wire so
      // the web client matches structured codes, not message substrings.
      errorFormatter: appErrorFormatter,
      logger: new CustomLogger(),
      // superjson preserves Date, Map, Set, BigInt, Decimal across the wire.
      // Must match the transformer wired on the tRPC client (apps/web/src/lib/trpc.ts).
      transformer: superjson,
      // Applied to every procedure. IdempotencyMiddleware is deliberately NOT
      // here: global middlewares run before route-level AuthMiddleware, so
      // ctx.user would never be set and it would no-op on every request. It is
      // wired method-level after AuthMiddleware on the mutation routers
      // instead (e.g. user.router.ts, auth.router.ts). See
      // idempotency.middleware.ts.
      // TrpcRequestContextMiddleware MUST stay first: it opens the ALS request
      // scope that AuthMiddleware writes `userId`/`tenantId` into, and that the
      // Prisma tenant-scope extension reads. nestjs-trpc mounts outside the
      // express pipeline RequestContextMiddleware runs in, so without this every
      // tenant-scoped query fails closed and no tRPC log carries a requestId.
      globalMiddlewares: [TrpcRequestContextMiddleware, TrpcTimingMiddleware],
    }),
    HealthModule,
    MetricsModule,
    MailModule,
    SessionModule,
    AuthModule,
    UserModule,
    DataExportModule,
    StorageModule,
    WorkspaceModule,
  ],
  providers: [
    PingRouter,
    AppContext,
    AppErrorHandler,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
