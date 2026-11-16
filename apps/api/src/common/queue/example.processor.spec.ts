import { Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import type { Job } from 'bullmq';
import { ExampleProcessor } from './example.processor';
import { QueueProcessor } from './queue-processor';

const jobWith = (data: unknown): Job =>
  ({ id: 'job-7', name: 'greet', queueName: 'example', data }) as unknown as Job;

describe('ExampleProcessor', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('is a QueueProcessor, so it inherits the job context and failure reporting', () => {
    expect(new ExampleProcessor()).toBeInstanceOf(QueueProcessor);
  });

  it('processes a valid payload and names the job and the user in its log line', async () => {
    await new ExampleProcessor().processJob(jobWith({ userId: 'u-1', message: 'hi' }));

    expect(logSpy).toHaveBeenCalledWith('Processing example job job-7 for user u-1');
  });

  it('falls back to "anon" when the payload carries no userId', async () => {
    await new ExampleProcessor().processJob(jobWith({}));

    expect(logSpy).toHaveBeenCalledWith('Processing example job job-7 for user anon');
  });

  it('ignores keys the schema does not name instead of rejecting the payload', async () => {
    await expect(
      new ExampleProcessor().processJob(jobWith({ userId: 'u-1', extra: { requestId: 'r-1' } })),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['an empty userId', { userId: '' }],
    ['a non-string message', { message: 42 }],
    ['a payload that is not an object', 'not-an-object'],
  ])(
    'fails %s straight to the DLQ as an UnrecoverableError, without running the body',
    async (_, data) => {
      const run = new ExampleProcessor().processJob(jobWith(data));

      await expect(run).rejects.toBeInstanceOf(UnrecoverableError);
      expect(logSpy).not.toHaveBeenCalled();
    },
  );

  it('reports issue paths and codes but never the payload values', async () => {
    const run = new ExampleProcessor().processJob(
      jobWith({ userId: '', message: 'secret@example.net' }),
    );

    await expect(run).rejects.toThrow(
      'Invalid example#greet payload (id=job-7): userId: too_small',
    );
    await expect(run).rejects.not.toThrow(/secret@example\.net/u);
  });
});
