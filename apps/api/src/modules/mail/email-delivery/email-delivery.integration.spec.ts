// Mock the ESM-only @repo/email loader so the renderer returns deterministic
// HTML in jest's CJS context (same approach as mail.service.spec).
jest.mock('../../../common/utils/esm-import', () => ({
  esmImport: jest.fn().mockResolvedValue({
    renderVerificationEmail: jest.fn().mockResolvedValue('<verif/>'),
    renderPasswordResetEmail: jest.fn().mockResolvedValue('<reset/>'),
    renderWelcomeEmail: jest.fn().mockResolvedValue('<welcome/>'),
    renderPasswordChangedEmail: jest.fn().mockResolvedValue('<changed/>'),
  }),
}));

const sendMailMock = jest.fn().mockResolvedValue({});
jest.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: sendMailMock }) }));

import { Global, Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import RedisMock from 'ioredis-mock';
import { Queue } from 'bullmq';
import { EmailDeliveryWorkerModule } from './email-delivery-worker.module';
import type { Job } from 'bullmq';
import { MailService } from '../mail.service';
import { MailModule } from '../mail.module';
import { EmailDeliveryProcessor } from './email-delivery.processor';
import { EMAIL_DELIVERY_JOB_NAMES, EMAIL_DELIVERY_QUEUE_NAME } from './email-delivery.constants';
import { EMAIL_PROVIDER, type IEmailProvider } from '../providers/email-provider.interface';
import { QueueObservabilityModule } from '../../../common/queue/queue-observability.module';
import { QueueMetricsService } from '../../../common/queue/queue-metrics.service';
import { HealthModule } from '../../health/health.module';
import { QueueHealthIndicator } from '../../health/indicators/queue.health';
import { PrismaService } from '../../../common/database/prisma.service';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { CustomLogger } from '../../logger/logger.service';
import { AuditService } from '../../audit/audit.service';

// Stand in for the @Global PrismaModule / RedisModule / LoggerModule /
// AuditModule so the cross-module graph resolves without booting real infra.
// PrismaService/Redis/Audit are only constructed here, never exercised.
@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: {} },
    { provide: REDIS_CLIENT, useValue: new RedisMock() },
    { provide: CustomLogger, useValue: new CustomLogger() },
    { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
  ],
  exports: [PrismaService, REDIS_CLIENT, CustomLogger, AuditService],
})
class TestGlobalsModule {}

/**
 * Boots the real mail module subgraph (the producer, the queue, the
 * observability layer, and the health module that injects across module
 * boundaries) on an ioredis-mock-backed BullMQ root. This is the test that
 * verifies the DI graph actually RESOLVES, the class of bug a direct
 * `new Service()` unit test cannot catch (e.g. an indicator provided in a
 * module that does not import TerminusModule). `.compile()` instantiates every
 * provider but does not start the BullMQ worker loop, so ioredis-mock's lack of
 * blocking-command support is irrelevant; jobs are run through the fully-wired
 * processor directly.
 */
describe('email-delivery DI graph + job run (ioredis-mock)', () => {
  let moduleRef: TestingModule;
  const provider: jest.Mocked<IEmailProvider> = { send: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        TestGlobalsModule,
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              APP_NAME: 'TestApp',
              // MailService reads APP_URL via getOrThrow in its constructor
              // (for the settings deep-link). Provide it explicitly so this
              // spec compiles the module in CI, where no .env file is present.
              APP_URL: 'http://localhost:5173',
              SMTP_HOST: 'mailpit',
              SMTP_PORT: 1025,
              SMTP_USER: '',
              SMTP_PASS: '',
              SMTP_FROM: 'noreply@test',
            }),
          ],
        }),
        // Stand-in Bull root on ioredis-mock so registerQueue resolves without
        // a real Redis. (QueueModule's own forRootAsync/Redis fix is unit-tested
        // separately in queue.module.spec.ts.)
        BullModule.forRoot({ connection: new RedisMock() as never }),
        MailModule,
        EmailDeliveryWorkerModule,
        QueueObservabilityModule,
        HealthModule,
      ],
    })
      .overrideProvider(EMAIL_PROVIDER)
      .useValue(provider)
      .compile();
  });

  afterAll(async () => {
    if (!moduleRef) return;
    // BullMQ's connection teardown against ioredis-mock emits a spurious
    // unhandled 'error' (the mock's Lua/INFO responses don't match what BullMQ
    // expects on close). Swallow it for the close window so it doesn't crash the
    // worker; the connections still close, so no handles leak.
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

  it('resolves every cross-module provider (the wiring-bug discriminator)', () => {
    expect(moduleRef.get(MailService)).toBeInstanceOf(MailService);
    expect(moduleRef.get(EmailDeliveryProcessor)).toBeInstanceOf(EmailDeliveryProcessor);
    expect(moduleRef.get(QueueMetricsService)).toBeInstanceOf(QueueMetricsService);
    // The indicator that injects HealthIndicatorService (TerminusModule) AND
    // QueueMetricsService (QueueObservabilityModule) across module boundaries.
    expect(moduleRef.get(QueueHealthIndicator)).toBeInstanceOf(QueueHealthIndicator);
  });

  it('runs a send-welcome job through the fully-wired processor', async () => {
    const processor = moduleRef.get(EmailDeliveryProcessor);
    const job = {
      name: EMAIL_DELIVERY_JOB_NAMES.SEND_WELCOME,
      data: { to: 'jane@example.com', props: { loginUrl: 'https://login', appName: 'TestApp' } },
    } as Job;

    await processor.processJob(job);

    expect(provider.send).toHaveBeenCalledWith({
      to: 'jane@example.com',
      subject: 'Welcome to TestApp!',
      html: '<welcome/>',
    });
  });

  it('injects a live queue into MailService (producer wiring)', () => {
    // The producer side is proven two ways without a Redis round-trip: resolving
    // MailService above requires the @InjectQueue(EMAIL_DELIVERY) token to be
    // wired, and the queue token resolves to a real BullMQ Queue with `.add`.
    // The actual enqueue + argument shape is asserted in mail.service.spec.ts.
    // (A real `queue.add` cannot run here: ioredis-mock's Lua VM lacks
    // `cmsgpack`, which BullMQ's add script requires, the reason this repo only
    // uses ioredis-mock for plain REDIS_CLIENT, never for BullMQ.)
    const queue = moduleRef.get<Queue>(getQueueToken(EMAIL_DELIVERY_QUEUE_NAME));
    expect(queue).toBeInstanceOf(Queue);
    expect(moduleRef.get(MailService)).toBeInstanceOf(MailService);
  });
});
