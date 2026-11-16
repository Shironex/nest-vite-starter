import { UnrecoverableError } from 'bullmq';
import type { Job } from 'bullmq';
import { getRequestContext, type IRequestContext } from '../context/request-context';
import { isFinalJobAttempt, TracedWorkerHost } from './traced-worker.host';
import { queueJobDurationSeconds, queueJobFailuresTotal } from './queue.metrics';

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
 * The instrumentation half. `TracedWorkerHost.process` is the only place the
 * four queues share, which is why the duration histogram and the failure
 * counter live there rather than in any processor, and why they need a test
 * that goes through `process`, not through the metric objects directly.
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

  let observed: { labels: Record<string, string>; seconds: number }[];
  let failures: Record<string, string>[];
  let timerSpy: jest.SpyInstance;
  let counterSpy: jest.SpyInstance;

  beforeEach(() => {
    observed = [];
    failures = [];
    timerSpy = jest.spyOn(queueJobDurationSeconds, 'startTimer').mockImplementation(
      () =>
        ((labels: Record<string, string>) => {
          observed.push({ labels, seconds: 0 });
          return 0;
        }) as unknown as ReturnType<typeof queueJobDurationSeconds.startTimer>,
    );
    counterSpy = jest.spyOn(queueJobFailuresTotal, 'inc').mockImplementation(((
      labels: Record<string, string>,
    ) => {
      failures.push(labels);
    }) as unknown as typeof queueJobFailuresTotal.inc);
  });

  afterEach(() => {
    timerSpy.mockRestore();
    counterSpy.mockRestore();
  });

  it('times a successful attempt with ok=true and counts no failure', async () => {
    const processor = new TestProcessor(() => Promise.resolve('done'));

    await expect(processor.process(jobFor(0, 3))).resolves.toBe('done');

    expect(observed).toEqual([
      {
        labels: { queue: 'email-delivery', job_name: 'send-verification', ok: 'true' },
        seconds: 0,
      },
    ]);
    expect(failures).toEqual([]);
  });

  // The `_ctx` envelope is JSON out of Redis and it becomes the tenant scope
  // every scoped Prisma call in the processor runs under, so it is parsed
  // rather than asserted. A replayed or hand-edited job runs with NO context
  // instead of with a forged one.
  it('runs the job with no tenant scope when the context envelope is malformed', async () => {
    let seen: IRequestContext | undefined;
    const processor = new TestProcessor(() => {
      seen = getRequestContext();
      return Promise.resolve('done');
    });

    await processor.process(jobFor(0, 3, { _ctx: { tenantId: { not: '' } } }));

    expect(seen?.tenantId).toBeUndefined();
  });

  it('carries a well-formed envelope into the ALS store', async () => {
    let seen: IRequestContext | undefined;
    const processor = new TestProcessor(() => {
      seen = getRequestContext();
      return Promise.resolve('done');
    });

    await processor.process(jobFor(0, 3, { _ctx: { tenantId: 'tenant-a' } }));

    expect(seen?.tenantId).toBe('tenant-a');
  });

  it('ignores a traceparent that is not a string', async () => {
    // The propagator would otherwise be handed an object off the queue.
    const processor = new TestProcessor(() => Promise.resolve('done'));

    await expect(processor.process(jobFor(0, 3, { _traceparent: { evil: true } }))).resolves.toBe(
      'done',
    );
  });

  it('times a failed attempt too, with ok=false, and still rethrows', async () => {
    // A processor that hangs and then fails is the case worth seeing, so the
    // timer has to run on the throw path as well as the return path.
    const processor = new TestProcessor(() => Promise.reject(new Error('smtp down')));

    await expect(processor.process(jobFor(0, 3))).rejects.toThrow('smtp down');

    expect(observed).toEqual([
      {
        labels: { queue: 'email-delivery', job_name: 'send-verification', ok: 'false' },
        seconds: 0,
      },
    ]);
  });

  it('counts a retryable failure as final=false', async () => {
    // Attempt 1 of 3: a retry will absorb this, so it is worth a rate to watch
    // and never worth paging.
    const processor = new TestProcessor(() => Promise.reject(new Error('smtp down')));

    await expect(processor.process(jobFor(0, 3))).rejects.toThrow('smtp down');

    expect(failures).toEqual([
      { queue: 'email-delivery', job_name: 'send-verification', final: 'false' },
    ]);
  });

  it('counts the last attempt as final=true (the job is now in the DLQ)', async () => {
    const processor = new TestProcessor(() => Promise.reject(new Error('smtp down')));

    await expect(processor.process(jobFor(2, 3))).rejects.toThrow('smtp down');

    expect(failures).toEqual([
      { queue: 'email-delivery', job_name: 'send-verification', final: 'true' },
    ]);
  });

  it('counts an UnrecoverableError as final on its first throw', async () => {
    // No retries follow, so the counter must agree with the Sentry gate that
    // this attempt was the last one.
    const processor = new TestProcessor(() =>
      Promise.reject(new UnrecoverableError('bad payload')),
    );

    await expect(processor.process(jobFor(0, 5))).rejects.toThrow('bad payload');

    expect(failures).toEqual([
      { queue: 'email-delivery', job_name: 'send-verification', final: 'true' },
    ]);
  });
});
