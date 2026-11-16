import { UnrecoverableError } from 'bullmq';
import type { Job } from 'bullmq';
import { getRequestContext, type IRequestContext } from '../context/request-context';
import { isFinalJobAttempt, TracedWorkerHost } from './traced-worker.host';

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
    // UnrecoverableError fails the job straight to the DLQ with no retries,
    // so its first throw IS the final failure.
    expect(isFinalJobAttempt(makeJob(0, 5), new UnrecoverableError('bad payload'))).toBe(true);
  });
});

/**
 * The wrapper half. `TracedWorkerHost.process` is the only place every queue
 * shares, so these go through `process` rather than `processJob` directly.
 */
describe('TracedWorkerHost instrumentation', () => {
  class TestProcessor extends TracedWorkerHost {
    constructor(private readonly behaviour: () => Promise<unknown>) {
      super();
    }
    async processJob(): Promise<unknown> {
      return this.behaviour();
    }
  }

  const jobFor = (
    attemptsMade: number,
    maxAttempts: number,
    data: Record<string, unknown> = {},
  ): Job =>
    ({
      id: 'job-1',
      name: 'send-verification',
      queueName: 'email-delivery',
      data,
      attemptsMade,
      opts: { attempts: maxAttempts },
    }) as unknown as Job;

  it('returns what the processor returned', async () => {
    const processor = new TestProcessor(() => Promise.resolve('done'));

    await expect(processor.process(jobFor(0, 3))).resolves.toBe('done');
  });

  it('rethrows a failed attempt so BullMQ can retry it', async () => {
    const processor = new TestProcessor(() => Promise.reject(new Error('smtp down')));

    await expect(processor.process(jobFor(0, 3))).rejects.toThrow('smtp down');
  });

  // The `_ctx` envelope is JSON out of Redis and it becomes the ALS actor
  // every audit row in the processor is written under, so it is parsed
  // rather than asserted. A replayed or hand-edited job runs with NO context
  // instead of with a forged one.
  it('runs the job with no actor when the context envelope is malformed', async () => {
    let seen: IRequestContext | undefined;
    const processor = new TestProcessor(() => {
      seen = getRequestContext();
      return Promise.resolve('done');
    });

    await processor.process(jobFor(0, 3, { _ctx: { userId: { not: '' } } }));

    expect(seen?.userId).toBeUndefined();
  });

  it('carries a well-formed envelope into the ALS store', async () => {
    let seen: IRequestContext | undefined;
    const processor = new TestProcessor(() => {
      seen = getRequestContext();
      return Promise.resolve('done');
    });

    await processor.process(jobFor(0, 3, { _ctx: { userId: 'u-1' } }));

    expect(seen?.userId).toBe('u-1');
  });

  it('ignores a traceparent that is not a string', async () => {
    // The propagator would otherwise be handed an object off the queue.
    const processor = new TestProcessor(() => Promise.resolve('done'));

    await expect(processor.process(jobFor(0, 3, { _traceparent: { evil: true } }))).resolves.toBe(
      'done',
    );
  });
});
