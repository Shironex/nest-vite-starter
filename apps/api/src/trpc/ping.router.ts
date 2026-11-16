import { Router, Query, Input } from 'nestjs-trpc';
import { pingInputSchema, pingOutputSchema } from '@repo/shared/schemas';
import { nowMs } from '../common/clock';

@Router({ alias: 'ping' })
export class PingRouter {
  @Query({
    input: pingInputSchema,
    output: pingOutputSchema,
  })
  ping(@Input('message') message?: string) {
    return {
      pong: message ?? 'pong',
      timestamp: nowMs(),
    };
  }
}
