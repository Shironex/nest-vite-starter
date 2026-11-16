import { removeStaleJobSchedulers } from './stale-job-schedulers';

const buildQueue = (schedulers: { key: string; name: string }[]) => ({
  getJobSchedulers: jest.fn().mockResolvedValue(schedulers),
  removeJobScheduler: jest.fn().mockResolvedValue(true),
});

describe('removeStaleJobSchedulers', () => {
  it('removes a scheduler that produces a managed job name under another id', async () => {
    // BullMQ 5 stored legacy repeatables under an md5 hash; BullMQ 6 lists them
    // as ordinary schedulers.
    const queue = buildQueue([{ key: 'f80cc647a5290b107c0e7951ba13af9c', name: 'sweep' }]);

    const removed = await removeStaleJobSchedulers(queue, ['sweep'], ['sweep-daily']);

    expect(removed).toBe(1);
    expect(queue.removeJobScheduler).toHaveBeenCalledWith('f80cc647a5290b107c0e7951ba13af9c');
  });

  it('keeps the canonical scheduler', async () => {
    const queue = buildQueue([{ key: 'sweep-daily', name: 'sweep' }]);

    const removed = await removeStaleJobSchedulers(queue, ['sweep'], ['sweep-daily']);

    expect(removed).toBe(0);
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
  });

  it('leaves schedulers for job names it does not manage', async () => {
    const queue = buildQueue([{ key: 'someone-else', name: 'other' }]);

    const removed = await removeStaleJobSchedulers(queue, ['sweep'], ['sweep-daily']);

    expect(removed).toBe(0);
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
  });
});
