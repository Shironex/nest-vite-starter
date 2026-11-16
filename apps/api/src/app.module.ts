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
import { MailModule } from './modules/mail/mail.module';
import { SessionModule } from './modules/auth/session.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { DataExportModule } from './modules/data-export/data-export.module';
import { QueueModule } from './common/queue/queue.module';
import { QueueObservabilityModule } from './common/queue/queue-observability.module';
import { RequestContextModule } from './common/context/request-context.module';
import { AuditModule } from './modules/audit/audit.module';
import { SecurityModule } from './common/security/security.module';
import { TrpcRequestContextModule } from './common/trpc/trpc-request-context.module';
import { TrpcRequestContextMiddleware } from './common/trpc/trpc-request-context.middleware';

const envFilePath = '.env';

// Global fallback limit shared across replicas via Redis; sensitive surfaces
// (auth, csrf-token) layer their own tighter per-route throttles.
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
      // Applied to every procedure.
      // TrpcRequestContextMiddleware MUST stay first: it opens the ALS request
      // scope that AuthMiddleware writes `userId` into, and that AuditService
      // and the logger read. nestjs-trpc mounts outside the express pipeline
      // RequestContextMiddleware runs in, so without this no audit row carries
      // its actor and no tRPC log carries a requestId.
      globalMiddlewares: [TrpcRequestContextMiddleware],
    }),
    HealthModule,
    MailModule,
    SessionModule,
    AuthModule,
    UserModule,
    DataExportModule,
  ],
  providers: [
    PingRouter,
    AppContext,
    AppErrorHandler,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
