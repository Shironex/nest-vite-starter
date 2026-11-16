import { RedisHealthIndicator } from './redis.health';

const buildIndicator = (pingImpl: jest.Mock) => {
  const up = jest.fn((meta: unknown) => ({ redis: { status: 'up', ...(meta as object) } }));
  const down = jest.fn((meta: unknown) => ({ redis: { status: 'down', ...(meta as object) } }));
  const healthIndicatorService = { check: jest.fn().mockReturnValue({ up, down }) };
  const redis = { ping: pingImpl };
  const indicator = new RedisHealthIndicator(
    healthIndicatorService as unknown as ConstructorParameters<typeof RedisHealthIndicator>[0],
    redis as unknown as ConstructorParameters<typeof RedisHealthIndicator>[1],
  );
  return { indicator, up, down };
};

describe('RedisHealthIndicator', () => {
  it('returns up({ latency }) when ping resolves "PONG"', async () => {
    const { indicator, up, down } = buildIndicator(jest.fn().mockResolvedValue('PONG'));
    await indicator.isHealthy('redis');
    expect(up).toHaveBeenCalledWith(expect.objectContaining({ latency: expect.any(Number) }));
    expect(down).not.toHaveBeenCalled();
  });

  it('returns down with explanatory error when ping resolves to non-PONG', async () => {
    const { indicator, up, down } = buildIndicator(jest.fn().mockResolvedValue('OK'));
    await indicator.isHealthy('redis');
    expect(up).not.toHaveBeenCalled();
    expect(down).toHaveBeenCalledWith({ error: 'Unexpected response: OK' });
  });

  it('returns down with error message when ping rejects', async () => {
    const { indicator, down } = buildIndicator(
      jest.fn().mockRejectedValue(new Error('redis down')),
    );
    await indicator.isHealthy('redis');
    expect(down).toHaveBeenCalledWith({ error: 'redis down' });
  });
});
