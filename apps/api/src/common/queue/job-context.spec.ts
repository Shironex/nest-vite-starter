import { rebuildRequestContextFromJob } from './job-context';

/**
 * The queue as an INPUT.
 *
 * The producer stamps `_ctx` server-side from the ALS, so nothing a client
 * sends reaches it and no code path writes an envelope these tests reject. What
 * they pin is the behavior when the blob does not come from that producer: a
 * job replayed from a queue UI with edited data, a payload written by an older
 * or newer deploy, or anything holding Redis write access. `tenantId` off this
 * envelope becomes the ALS scope the Prisma tenant-scope extension splices into
 * every `where`, and that extension is the only tenancy boundary there is.
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
          tenantId: 'tenant-a',
          workspaceId: 'workspace-a',
        },
        'job-9',
      ),
    ).toEqual({
      requestId: 'req-1',
      userId: 'u-1',
      traceId: 't-1',
      spanId: 's-1',
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
    });
  });

  it('falls back to a job-derived requestId when there is no envelope', () => {
    expect(rebuildRequestContextFromJob(undefined, 'job-9')).toEqual({
      requestId: 'job-job-9',
      userId: undefined,
      traceId: undefined,
      spanId: undefined,
      tenantId: undefined,
      workspaceId: undefined,
    });
  });

  it('names the context even when the job has no id', () => {
    expect(rebuildRequestContextFromJob(undefined, undefined).requestId).toBe('job-no-context');
  });

  // The one that matters. `{ not: '' }` is a legal Prisma filter, so a tenantId
  // that is an object rather than a string turns every scoped query in the
  // worker into a cross-tenant one.
  it('drops an envelope whose tenantId is a Prisma filter rather than an id', () => {
    const context = rebuildRequestContextFromJob({ tenantId: { not: '' }, userId: 'u-1' }, 'job-9');

    expect(context.tenantId).toBeUndefined();
    // The WHOLE envelope goes, not just the offending field: a partly trusted
    // context is worse than none.
    expect(context.userId).toBeUndefined();
    expect(context.requestId).toBe('job-job-9');
  });

  it('drops an envelope carrying an empty tenantId', () => {
    expect(rebuildRequestContextFromJob({ tenantId: '' }, 'job-9').tenantId).toBeUndefined();
  });

  it('drops an envelope carrying a field the producer never writes', () => {
    // `.strict()`: a field that rides along unnoticed is how the next version of
    // this defect gets in.
    expect(
      rebuildRequestContextFromJob({ tenantId: 'tenant-a', role: 'ADMIN' }, 'job-9').tenantId,
    ).toBeUndefined();
  });

  it.each([['a string'], [42], [['tenant-a']], [true]])(
    'drops an envelope that is not an object at all (%p)',
    (envelope) => {
      expect(rebuildRequestContextFromJob(envelope, 'job-9')).toEqual({
        requestId: 'job-job-9',
        userId: undefined,
        traceId: undefined,
        spanId: undefined,
        tenantId: undefined,
        workspaceId: undefined,
      });
    },
  );

  it('treats null like a missing envelope rather than a malformed one', () => {
    expect(rebuildRequestContextFromJob(null, 'job-9').requestId).toBe('job-job-9');
  });
});
