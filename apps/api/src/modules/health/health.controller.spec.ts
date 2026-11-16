import { HealthController } from './health.controller';

const buildController = () => {
  const health = { check: jest.fn().mockResolvedValue({ status: 'ok' }) };
  const db = { isHealthy: jest.fn() };
  const redis = { isHealthy: jest.fn() };
  const memory = { checkHeap: jest.fn() };
  const queue = { isHealthy: jest.fn() };
  const controller = new HealthController(
    health as unknown as ConstructorParameters<typeof HealthController>[0],
    db as unknown as ConstructorParameters<typeof HealthController>[1],
    redis as unknown as ConstructorParameters<typeof HealthController>[2],
    memory as unknown as ConstructorParameters<typeof HealthController>[3],
    queue as unknown as ConstructorParameters<typeof HealthController>[4],
  );
  return { controller, health, db, redis, memory, queue };
};

describe('HealthController', () => {
  it('live() returns { status: "ok" } with no dependencies', () => {
    const { controller, health } = buildController();
    expect(controller.live()).toEqual({ status: 'ok' });
    expect(health.check).not.toHaveBeenCalled();
  });

  it('ready() runs [db, redis, memory] and EXCLUDES the queue indicator (no depooling)', async () => {
    const { controller, health, db, redis, memory, queue } = buildController();
    db.isHealthy.mockResolvedValue({ database: { status: 'up' } });
    redis.isHealthy.mockResolvedValue({ redis: { status: 'up' } });
    memory.checkHeap.mockResolvedValue({ memory: { status: 'up' } });

    await controller.ready();
    const checks = health.check.mock.calls[0]?.[0] as Array<() => Promise<unknown>>;
    expect(checks).toHaveLength(3);
    await Promise.all(checks.map((fn) => fn()));
    expect(db.isHealthy).toHaveBeenCalledWith('database');
    expect(redis.isHealthy).toHaveBeenCalledWith('redis');
    expect(memory.checkHeap).toHaveBeenCalledWith('memory', 150 * 1024 * 1024);
    // A mail backlog must never pull the node from the pool.
    expect(queue.isHealthy).not.toHaveBeenCalled();
  });

  it('check() (GET /health) additionally runs the observability-only queue indicator', async () => {
    const { controller, health, db, redis, memory, queue } = buildController();
    db.isHealthy.mockResolvedValue({ database: { status: 'up' } });
    redis.isHealthy.mockResolvedValue({ redis: { status: 'up' } });
    memory.checkHeap.mockResolvedValue({ memory: { status: 'up' } });
    queue.isHealthy.mockReturnValue({ queue: { status: 'up' } });

    await controller.check();
    const checks = health.check.mock.calls[0]?.[0] as Array<() => Promise<unknown>>;
    expect(checks).toHaveLength(4);
    await Promise.all(checks.map((fn) => fn()));
    expect(db.isHealthy).toHaveBeenCalled();
    expect(redis.isHealthy).toHaveBeenCalled();
    expect(memory.checkHeap).toHaveBeenCalled();
    expect(queue.isHealthy).toHaveBeenCalledWith('queue');
  });
});
