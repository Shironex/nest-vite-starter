import { UnrecoverableError } from 'bullmq';
import type { Job } from 'bullmq';
import { requestContext } from '../../../common/context/request-context';
import { NotificationDispatchProcessor } from './notification-dispatch.processor';
import { NOTIFICATION_DISPATCH_JOB_NAMES } from './notification-dispatch.constants';

// id: null models a job BullMQ gave no id (a plain `undefined` argument would
// re-trigger the default parameter).
const makeJob = (name: string, data: unknown, id: string | null = 'job-1'): Job =>
  ({ name, data, id: id ?? undefined, attemptsMade: 0, opts: { attempts: 3 } }) as Job;

const validData = {
  userId: 'u-1',
  notification: { type: 'info', title: 'Hi', message: 'Hello there' },
};

const row = {
  id: 'n-1',
  type: 'info',
  title: 'Hi',
  message: 'Hello there',
  readAt: null,
  createdAt: new Date('2026-07-02T10:00:00Z'),
};

const buildSubject = () => {
  const repository = {
    create: jest.fn().mockResolvedValue(row),
    findByJobId: jest.fn().mockResolvedValue(null),
  };
  const eventsService = { notifyUser: jest.fn() };
  const processor = new NotificationDispatchProcessor(
    repository as unknown as ConstructorParameters<typeof NotificationDispatchProcessor>[0],
    eventsService as unknown as ConstructorParameters<typeof NotificationDispatchProcessor>[1],
  );
  return { processor, repository, eventsService };
};

describe('NotificationDispatchProcessor', () => {
  it('persists the row FIRST, then emits a socket payload built from the row (id + createdAt)', async () => {
    const { processor, repository, eventsService } = buildSubject();

    await processor.processJob(
      makeJob(NOTIFICATION_DISPATCH_JOB_NAMES.DISPATCH, {
        ...validData,
        _ctx: { requestId: 'r1' },
      }),
    );

    expect(repository.create).toHaveBeenCalledWith({
      userId: 'u-1',
      tenantId: null,
      type: 'info',
      title: 'Hi',
      message: 'Hello there',
      jobId: 'job-1',
    });
    expect(eventsService.notifyUser).toHaveBeenCalledWith('u-1', {
      id: 'n-1',
      type: 'info',
      title: 'Hi',
      message: 'Hello there',
      timestamp: row.createdAt.getTime(),
    });
    // The emit consumes the persisted row, so persist must resolve first.
    const createOrder = repository.create.mock.invocationCallOrder[0]!;
    const emitOrder = (eventsService.notifyUser as jest.Mock).mock.invocationCallOrder[0]!;
    expect(createOrder).toBeLessThan(emitOrder);
  });

  it('stamps tenantId from the rebuilt ALS job context when present', async () => {
    const { processor, repository } = buildSubject();

    await requestContext.run({ requestId: 'job-r1', tenantId: 't-9' }, () =>
      processor.processJob(makeJob(NOTIFICATION_DISPATCH_JOB_NAMES.DISPATCH, validData)),
    );

    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't-9' }));
  });

  it('is idempotent under retry: an existing row (unique jobId) is re-emitted, never re-created', async () => {
    const { processor, repository, eventsService } = buildSubject();
    repository.findByJobId.mockResolvedValue(row);

    await processor.processJob(makeJob(NOTIFICATION_DISPATCH_JOB_NAMES.DISPATCH, validData));

    expect(repository.findByJobId).toHaveBeenCalledWith('job-1');
    expect(repository.create).not.toHaveBeenCalled();
    expect(eventsService.notifyUser).toHaveBeenCalledWith(
      'u-1',
      expect.objectContaining({ id: 'n-1' }),
    );
  });

  it('creates with jobId null (and skips the dedupe lookup) when BullMQ gave the job no id', async () => {
    const { processor, repository } = buildSubject();

    await processor.processJob(makeJob(NOTIFICATION_DISPATCH_JOB_NAMES.DISPATCH, validData, null));

    expect(repository.findByJobId).not.toHaveBeenCalled();
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ jobId: null }));
  });

  it('fails a malformed payload straight to the DLQ with UnrecoverableError, before any write', async () => {
    const { processor, repository } = buildSubject();
    const failure = processor.processJob(
      makeJob(NOTIFICATION_DISPATCH_JOB_NAMES.DISPATCH, {
        userId: 'u-1',
        notification: { type: 'debug', title: 'Hi', message: 'x' },
      }),
    );
    await expect(failure).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(failure).rejects.toThrow(/Invalid .*dispatch payload/);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('throws a non-retryable UnrecoverableError on an unknown job name', async () => {
    const { processor } = buildSubject();
    const failure = processor.processJob(makeJob('nope', {}));
    await expect(failure).rejects.toThrow(/Unknown notification-dispatch job name/);
    await expect(failure).rejects.toBeInstanceOf(UnrecoverableError);
  });
});
