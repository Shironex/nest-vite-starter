import { rebuildRequestContextFromJob } from './job-context';

/**
 * The queue as an INPUT.
 *
 * The producer stamps `_ctx` server-side from the ALS, so nothing a client
 * sends reaches it and no code path writes an envelope these tests reject. What
 * they pin is the behavior when the blob does not come from that producer: a
 * job replayed from a queue UI with edited data, a payload written by an older
 * or newer deploy, or anything holding Redis write access. `userId` off this
 * envelope becomes the ALS actor that audit rows are written under.
 */
describe('rebuildRequestContextFromJob', () => {
  it('carries a well-formed envelope through unchanged', () => {
    expect(
      rebuildRequestContextFromJob(
        {
          requestId: 'req-1',
          userId: 'u-1',
          traceId: 't-1',
          spanId: 's-1',
        },
        'job-9',
      ),
    ).toEqual({
      requestId: 'req-1',
      userId: 'u-1',
      traceId: 't-1',
      spanId: 's-1',
    });
  });

  it('falls back to a job-derived requestId when there is no envelope', () => {
    expect(rebuildRequestContextFromJob(undefined, 'job-9')).toEqual({
      requestId: 'job-job-9',
      userId: undefined,
      traceId: undefined,
      spanId: undefined,
    });
  });

  it('names the context even when the job has no id', () => {
    expect(rebuildRequestContextFromJob(undefined, undefined).requestId).toBe('job-no-context');
  });

  // `{ not: '' }` is a legal Prisma filter, so a userId that is an object
  // rather than a string must never become the ALS actor.
  it('drops an envelope whose userId is a Prisma filter rather than an id', () => {
    const context = rebuildRequestContextFromJob(
      { userId: { not: '' }, requestId: 'req-1' },
      'job-9',
    );

    expect(context.userId).toBeUndefined();
    // The WHOLE envelope goes, not just the offending field: a partly trusted
    // context is worse than none.
    expect(context.requestId).toBe('job-job-9');
  });

  it('drops an envelope carrying an empty userId', () => {
    expect(rebuildRequestContextFromJob({ userId: '' }, 'job-9').userId).toBeUndefined();
  });

  it('drops an envelope carrying a field the producer never writes', () => {
    // `.strict()`: a field that rides along unnoticed is how the next version of
    // this defect gets in.
    expect(
      rebuildRequestContextFromJob({ userId: 'u-1', role: 'ADMIN' }, 'job-9').userId,
    ).toBeUndefined();
  });

  it.each([['a string'], [42], [['u-1']], [true]])(
    'drops an envelope that is not an object at all (%p)',
    (envelope) => {
      expect(rebuildRequestContextFromJob(envelope, 'job-9')).toEqual({
        requestId: 'job-job-9',
        userId: undefined,
        traceId: undefined,
        spanId: undefined,
      });
    },
  );

  it('treats null like a missing envelope rather than a malformed one', () => {
    expect(rebuildRequestContextFromJob(null, 'job-9').requestId).toBe('job-job-9');
  });
});
