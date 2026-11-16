import type Redis from 'ioredis';
import { createBullRedisConnection } from './queue.module';

/**
 * Unit-level proof that the BullMQ connection keeps REDIS_URL's credentials. A
 * factory that parsed only host+port from REDIS_URL would drop the password,
 * and every worker connection would fail NOAUTH on an auth-enabled Redis.
 * Asserting the password/db are preserved in the connection options, plus
 * `maxRetriesPerRequest === null`, proves it. (ioredis-mock cannot simulate NOAUTH, so a real
 * password-protected Redis integration check is left to manual/CI verification.)
 */
describe('createBullRedisConnection', () => {
  let conn: Redis | undefined;

  afterEach(() => {
    conn?.disconnect();
    conn = undefined;
  });

  it('preserves auth + db from the full REDIS_URL and sets maxRetriesPerRequest null', () => {
    conn = createBullRedisConnection('redis://:s3cr3t@127.0.0.1:6399/2');
    // Avoid an unhandled 'error' event (the target is unreachable in tests).
    conn.on('error', () => undefined);

    expect(conn.options.password).toBe('s3cr3t');
    expect(conn.options.host).toBe('127.0.0.1');
    expect(conn.options.port).toBe(6399);
    expect(conn.options.db).toBe(2);
    // Required for BullMQ blocking reads; must differ from the shared
    // REDIS_CLIENT (which uses 3).
    expect(conn.options.maxRetriesPerRequest).toBeNull();
  });
});
