import { runsInlineQueueWorker } from './queue-worker';

describe('runsInlineQueueWorker', () => {
  it('runs the workers in this process when QUEUE_WORKER is unset', () => {
    expect(runsInlineQueueWorker({})).toBe(true);
  });

  it('runs the workers in this process when QUEUE_WORKER=inline', () => {
    expect(runsInlineQueueWorker({ QUEUE_WORKER: 'inline' })).toBe(true);
  });

  it('leaves the workers to a separate process when QUEUE_WORKER=off', () => {
    expect(runsInlineQueueWorker({ QUEUE_WORKER: 'off' })).toBe(false);
  });
});
