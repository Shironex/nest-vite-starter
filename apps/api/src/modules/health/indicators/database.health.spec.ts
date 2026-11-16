import { DatabaseHealthIndicator } from './database.health';

const buildIndicator = (queryImpl: jest.Mock) => {
  const up = jest.fn((meta: unknown) => ({ db: { status: 'up', ...(meta as object) } }));
  const down = jest.fn((meta: unknown) => ({ db: { status: 'down', ...(meta as object) } }));
  const healthIndicatorService = { check: jest.fn().mockReturnValue({ up, down }) };
  const prisma = { client: { $queryRaw: queryImpl } };
  const indicator = new DatabaseHealthIndicator(
    healthIndicatorService as unknown as ConstructorParameters<typeof DatabaseHealthIndicator>[0],
    prisma as unknown as ConstructorParameters<typeof DatabaseHealthIndicator>[1],
  );
  return { indicator, up, down };
};

describe('DatabaseHealthIndicator', () => {
  it('returns up({ latency }) when $queryRaw resolves', async () => {
    const { indicator, up, down } = buildIndicator(
      jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    );
    const result = await indicator.isHealthy('database');
    expect(up).toHaveBeenCalledWith(expect.objectContaining({ latency: expect.any(Number) }));
    expect(down).not.toHaveBeenCalled();
    expect(result).toMatchObject({ db: { status: 'up' } });
  });

  it('returns down({ error }) when $queryRaw rejects', async () => {
    const { indicator, up, down } = buildIndicator(
      jest.fn().mockRejectedValue(new Error('connection refused')),
    );
    await indicator.isHealthy('database');
    expect(up).not.toHaveBeenCalled();
    expect(down).toHaveBeenCalledWith({ error: 'connection refused' });
  });
});
