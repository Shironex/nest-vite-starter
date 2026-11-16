import type { Queue } from 'bullmq';
import { APP_TIME_ZONE } from '../../../common/clock';
import { TwoFactorEnforcementScheduler } from './two-factor-enforcement.scheduler';
import {
  TWO_FACTOR_ENFORCEMENT_CRON,
  TWO_FACTOR_ENFORCEMENT_JOB_NAMES,
  TWO_FACTOR_ENFORCEMENT_SCHEDULER_ID,
} from './two-factor-enforcement.constants';
import { twoFactorEnforcementJobSchema } from './two-factor-enforcement.schemas';

const buildSubject = () => {
  const queue = {
    add: jest.fn().mockResolvedValue(undefined),
    upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
    getJobSchedulers: jest.fn().mockResolvedValue([]),
    removeJobScheduler: jest.fn().mockResolvedValue(true),
  };
  const scheduler = new TwoFactorEnforcementScheduler(queue as unknown as Queue);
  return { scheduler, queue };
};

describe('TwoFactorEnforcementScheduler', () => {
  afterEach(() => jest.clearAllMocks());

  it('registers the daily sweep as a job scheduler', async () => {
    const { scheduler, queue } = buildSubject();
    await scheduler.onModuleInit();
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      TWO_FACTOR_ENFORCEMENT_SCHEDULER_ID,
      { pattern: TWO_FACTOR_ENFORCEMENT_CRON, tz: APP_TIME_ZONE },
      { name: TWO_FACTOR_ENFORCEMENT_JOB_NAMES.SWEEP, data: expect.anything() },
    );
    // The legacy `add(..., { repeat })` path is gone in BullMQ 6.
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('enqueues a payload the worker will accept', async () => {
    const { scheduler, queue } = buildSubject();
    await scheduler.onModuleInit();
    const template = queue.upsertJobScheduler.mock.calls[0]?.[2] as { data: unknown };
    expect(twoFactorEnforcementJobSchema.safeParse(template.data).success).toBe(true);
  });

  it('upserts the same scheduler id on every boot', async () => {
    const { scheduler, queue } = buildSubject();
    await scheduler.onModuleInit();
    await scheduler.onModuleInit();
    const ids = queue.upsertJobScheduler.mock.calls.map((call) => call[0] as string);
    expect(new Set(ids)).toEqual(new Set([TWO_FACTOR_ENFORCEMENT_SCHEDULER_ID]));
  });

  it('removes the legacy repeatable still producing the sweep', async () => {
    const { scheduler, queue } = buildSubject();
    queue.getJobSchedulers.mockResolvedValue([
      { key: 'f80cc647a5290b107c0e7951ba13af9c', name: TWO_FACTOR_ENFORCEMENT_JOB_NAMES.SWEEP },
    ]);
    await scheduler.onModuleInit();
    expect(queue.removeJobScheduler).toHaveBeenCalledWith('f80cc647a5290b107c0e7951ba13af9c');
  });
});
