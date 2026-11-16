import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { UnrecoverableError } from 'bullmq';
import type { Job } from 'bullmq';
import { getRequestContext, type IRequestContext } from '../context/request-context';
import { isFinalJobAttempt, QueueProcessor } from './queue-processor';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const makeJob = (attemptsMade: number, maxAttempts?: number): Job =>
  ({
    attemptsMade,
    opts: maxAttempts === undefined ? {} : { attempts: maxAttempts },
  }) as Job;

describe('isFinalJobAttempt', () => {
  it('is false while BullMQ still has retries left', () => {
    // attemptsMade increments after an attempt finishes, so made=0 of max=5
    // means the 1st of 5 attempts is running now.
    expect(isFinalJobAttempt(makeJob(0, 5), new Error('x'))).toBe(false);
    expect(isFinalJobAttempt(makeJob(3, 5), new Error('x'))).toBe(false);
  });

  it('is true on the last configured attempt', () => {
    expect(isFinalJobAttempt(makeJob(4, 5), new Error('x'))).toBe(true);
  });

  it('is true when no attempts option is set (single-attempt job)', () => {
    expect(isFinalJobAttempt(makeJob(0), new Error('x'))).toBe(true);
  });

  it('is true for an UnrecoverableError regardless of remaining retries', () => {
    expect(isFinalJobAttempt(makeJob(0, 5), new UnrecoverableError('bad payload'))).toBe(true);
  });
});

describe('QueueProcessor', () => {
  class TestProcessor extends QueueProcessor {
    constructor(private readonly behaviour: () => Promise<unknown>) {
      super();
    }
    async processJob(): Promise<unknown> {
      return this.behaviour();
    }
  }

  const jobFor = (attemptsMade: number, maxAttempts: number, id: string | null = 'job-1') =>
    ({
      id: id ?? undefined,
      name: 'send-verification',
      queueName: 'email-delivery',
      data: {},
      attemptsMade,
      opts: { attempts: maxAttempts },
    }) as unknown as Job;

  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.mocked(Sentry.captureException).mockClear();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('returns what the processor returned', async () => {
    const processor = new TestProcessor(() => Promise.resolve('done'));

    await expect(processor.process(jobFor(0, 3))).resolves.toBe('done');
  });

  it('runs the job inside a request context named after the job', async () => {
    let seen: IRequestContext | undefined;
    const processor = new TestProcessor(() => {
      seen = getRequestContext();
      return Promise.resolve('done');
    });

    await processor.process(jobFor(0, 3, '42'));

    expect(seen).toEqual({ requestId: 'job-42' });
  });

  it('names the context even when the job has no id', async () => {
    let seen: IRequestContext | undefined;
    const processor = new TestProcessor(() => {
      seen = getRequestContext();
      return Promise.resolve('done');
    });

    await processor.process(jobFor(0, 3, null));

    expect(seen?.requestId).toBe('job-no-id');
  });

  it('rethrows a failed attempt so BullMQ can retry it, logging it but not paging', async () => {
    const processor = new TestProcessor(() => Promise.reject(new Error('smtp down')));

    await expect(processor.process(jobFor(0, 3))).rejects.toThrow('smtp down');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('reports the final failed attempt to Sentry', async () => {
    const processor = new TestProcessor(() => Promise.reject(new Error('smtp down')));

    await expect(processor.process(jobFor(2, 3))).rejects.toThrow('smtp down');
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        extra: expect.objectContaining({ queue: 'email-delivery', attempt: 3, maxAttempts: 3 }),
      }),
    );
  });
});
