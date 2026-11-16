// The standalone queue worker. Run it when the api is started with
// QUEUE_WORKER=off: `pnpm --filter @repo/api start:worker` (after a build), or
// `node dist/src/worker` in a container that shares the api image. Import order
// follows main.ts: ./load-env first, then ./instrument, before any @nestjs/*.
import { loadedEnvFiles } from './load-env';
import './instrument';

import * as Sentry from '@sentry/nestjs';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { CustomLogger, createAppLogger } from './modules/logger/logger.service';
import { installUnhandledRejectionPolicy } from './common/observability/unhandled-rejection';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  const logger = app.get(CustomLogger);
  app.useLogger(logger);
  app.enableShutdownHooks();

  logger.log(
    loadedEnvFiles.length > 0
      ? `Environment loaded from (first wins): ${loadedEnvFiles.join(', ')}`
      : 'No .env file found; using the process environment as-is',
    'Bootstrap',
  );
  logger.log('Queue worker running', 'Bootstrap');
}

installUnhandledRejectionPolicy({
  logger: createAppLogger('Process'),
  flush: (timeoutMs) => Sentry.flush(timeoutMs),
  exit: (code) => process.exit(code),
});

bootstrap().catch((err: unknown) => {
  createAppLogger('Bootstrap').error(
    'Fatal: queue worker bootstrap failed',
    err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
  );
  process.exit(1);
});
