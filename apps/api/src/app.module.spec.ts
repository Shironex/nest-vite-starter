// superjson is ESM-only (package `type: module`, no CJS build) and AppModule
// imports it as the tRPC `transformer` config value. Jest's CJS runtime cannot
// parse it, so stub it the same way email-delivery.integration.spec.ts stubs
// nodemailer / esm-import. The transformer is a config value here, never
// exercised by `.compile()` (the spec serializes nothing), so a no-op default
// is enough. `__esModule` + `default` matches the `import superjson` shape.
jest.mock('superjson', () => ({
  __esModule: true,
  default: {
    serialize: (value: unknown) => ({ json: value }),
    deserialize: (value: unknown) => value,
    stringify: (value: unknown) => JSON.stringify(value),
    parse: (value: string) => JSON.parse(value),
  },
}));

import { Test, type TestingModule } from '@nestjs/testing';
import RedisMock from 'ioredis-mock';
import { getQueueToken, getQueueOptionsToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ModulesContainer } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './common/database/prisma.service';
import { REDIS_CLIENT } from './common/redis/redis.module';
import { EMAIL_DELIVERY_QUEUE_NAME } from './modules/mail/email-delivery/email-delivery.constants';
import { QueueMetricsService } from './common/queue/queue-metrics.service';
import { QUEUE_NAMES } from './common/queue/queue.constants';

/**
 * AppModule compile-smoke: the cheapest possible guard against DI-graph
 * breakage (a provider that is unresolvable, a circular dependency, a module
 * that forgets to export something a sibling injects). Two prior CRITICAL boot
 * defects were exactly this bug class, and until now only the 15-minute
 * boot-smoke job caught them. This spec catches them in the sub-second unit
 * suite by `.compile()`-ing the REAL AppModule (with its real ConfigModule Joi
 * validation, fed by test/setup-env.ts) and asserting the graph resolved.
 *
 * It deliberately tests WIRING, not runtime: no `moduleRef.init()`, no
 * `createNestApplication()`, no `listen()`. Lifecycle hooks (onModuleInit,
 * @Cron / @Interval scheduling, the BullMQ worker loop) never fire, so no real
 * DB or Redis connection is ever opened.
 *
 * Infra seams overridden so `.compile()` constructs every singleton without
 * dialing live infra:
 *   - PrismaService: the @Global Prisma provider; a bare object is enough since
 *     nothing here calls it.
 *   - REDIS_CLIENT: the shared ioredis client. Its factory uses `lazyConnect`,
 *     so the real one would not dial at compile, but overriding keeps the spec
 *     hermetic regardless of a local Redis.
 *   - 'BULLMQ_CONFIG(default)': the QueueModule `forRootAsync` shared-config
 *     token. NestJS instantiates ALL singletons at `.compile()`, and this one's
 *     real factory runs `createBullRedisConnection(REDIS_URL)` -> `new Redis(...)`
 *     WITHOUT `lazyConnect`, i.e. a real socket at compile time. Pointing it at
 *     an ioredis-mock connection is the seam that actually neutralizes BullMQ's
 *     hidden infra coupling; the real `BullQueue_*` providers then construct on
 *     the mock, exercising the real queue wiring without a socket.
 *
 * The queue tokens are NOT overridden: the mock-backed shared config lets the
 * real Queue instances construct, so a missing/renamed @InjectQueue still fails
 * loudly here.
 */
describe('AppModule (DI compile-smoke)', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(REDIS_CLIENT)
      .useValue(new RedisMock())
      .overrideProvider('BULLMQ_CONFIG(default)')
      .useValue({ connection: new RedisMock() })
      .compile();
  });

  afterAll(async () => {
    if (!moduleRef) return;
    // BullMQ's connection teardown against ioredis-mock emits a spurious
    // unhandled 'error' (the mock's INFO/Lua responses do not match what BullMQ
    // expects on close). Swallow it for the close window so it does not crash
    // the runner; the connections still close, so no handles leak. Mirrors the
    // email-delivery integration spec's teardown.
    const swallow = (): void => undefined;
    process.on('uncaughtException', swallow);
    process.on('unhandledRejection', swallow);
    try {
      await moduleRef.close();
    } catch {
      // ignore teardown noise
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    process.off('uncaughtException', swallow);
    process.off('unhandledRejection', swallow);
  });

  it('resolves the full provider graph (the wiring-bug discriminator)', () => {
    expect(moduleRef).toBeDefined();
    expect(moduleRef.get(AppModule)).toBeDefined();
  });

  it('constructs the real BullMQ queue providers on the mock connection', () => {
    // Proves the @InjectQueue wiring resolves: if a queue token were renamed or
    // a queue-owning module dropped its `exports: [BullModule]`, this fails.
    expect(moduleRef.get(getQueueToken(EMAIL_DELIVERY_QUEUE_NAME))).toMatchObject({
      name: EMAIL_DELIVERY_QUEUE_NAME,
    });
  });

  it('registers EVERY queue in QUEUE_NAMES somewhere in the graph', () => {
    // The registry is what the metrics scrape and the DLQ alarm both iterate,
    // so a name declared here and registered nowhere is a queue that no gauge
    // covers and no alarm watches. `strict: false` is the same container-wide
    // lookup QueueMetricsService performs.
    for (const name of Object.values(QUEUE_NAMES)) {
      expect(moduleRef.get(getQueueToken(name), { strict: false })).toBeInstanceOf(Queue);
    }
  });

  it('lets the metrics scrape bind every declared queue from the real graph', () => {
    // QueueObservabilityModule imports no feature modules, so this compile is
    // the only place the container-wide resolution runs against the real module
    // graph rather than a fake injector. `.compile()` does not fire lifecycle
    // hooks, hence the explicit call; it binds Queue instances and opens
    // nothing (the scrape itself is @Interval-driven and never runs here).
    expect(() => moduleRef.get(QueueMetricsService).onModuleInit()).not.toThrow();
  });

  it('binds no provider to a value the tRPC router factory cannot read', () => {
    // THE BOOTSTRAP INVARIANT: it holds for every provider in the app, not for
    // one library.
    //
    // `nestjs-trpc`'s RouterFactory walks EVERY provider in the container and
    // reads `Reflect.getMetadata(ROUTER_METADATA_KEY, instance.constructor)`.
    // It guards `instance == null` and nothing else, so a provider whose value
    // has a null prototype reaches `Reflect.getMetadata` with an `undefined`
    // target, which throws a bare TypeError and kills the whole bootstrap
    // before a single route is serialized. The value that gets a null prototype
    // in practice is an ESM module namespace object bound with `useValue`.
    //
    // `.compile()` alone never catches this: the driver starts at
    // `onApplicationBootstrap`, which this spec deliberately does not reach. So
    // the precondition is asserted here directly, in the sub-second suite,
    // rather than being left to the fifteen-minute boot smoke.
    const offenders: string[] = [];
    for (const module of moduleRef.get(ModulesContainer).values()) {
      for (const wrapper of module.providers.values()) {
        const { instance } = wrapper;
        if (instance == null) continue;
        if ((instance as { constructor?: unknown }).constructor == null) {
          offenders.push(String(wrapper.name));
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('neutralizes the BullMQ connection (no live infra at compile)', () => {
    // `.overrideProvider(token)` silently NO-OPS if the token does not exist, so
    // a future @nestjs/bullmq bump that renames 'BULLMQ_CONFIG(default)' would
    // let the real `createBullRedisConnection` open a socket while this spec
    // stayed green. Asserting the resolved queue connection IS the mock turns
    // "no live infra" from a comment into an invariant that fails loudly if the
    // override seam ever drifts.
    const options = moduleRef.get<{ connection: unknown }>(
      getQueueOptionsToken(EMAIL_DELIVERY_QUEUE_NAME),
    );
    expect(options.connection).toBeInstanceOf(RedisMock);
  });
});
