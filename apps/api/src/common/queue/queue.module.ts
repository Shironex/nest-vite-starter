import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// Processors extend `QueueProcessor`. See ./index.ts and ./example.processor.ts
// for the pattern.
export * from './index';

/**
 * Build the dedicated ioredis connection BullMQ workers use.
 *
 * Two things the previous `{ host, port }` factory got wrong, both invisible in
 * local no-auth dev and fatal in any auth-enabled (prod) Redis:
 *
 *   1. It parsed only host+port out of `REDIS_URL`, dropping the password,
 *      db-index and TLS. Against a `requirepass` Redis every worker connection
 *      failed `NOAUTH` and all jobs wedged. Passing the full URL string to
 *      ioredis preserves auth/db/TLS.
 *   2. It omitted `maxRetriesPerRequest: null`, which BullMQ REQUIRES for its
 *      blocking reads (BRPOPLPUST). The shared `REDIS_CLIENT` deliberately uses
 *      `maxRetriesPerRequest: 3`, so this MUST be a separate ioredis instance,
 *      not a reuse of `REDIS_CLIENT`.
 */
export function createBullRedisConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
  });
}

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        connection: createBullRedisConnection(configService.getOrThrow<string>('REDIS_URL')),
      }),
      inject: [ConfigService],
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
