import type { PrismaClient } from '@repo/database' with { 'resolution-mode': 'import' };

// `@repo/database` is ESM-only and this suite runs as CJS, so the loader seam
// (esmImport) is the one thing replaced.
jest.mock('../utils/esm-import', () => ({ esmImport: jest.fn() }));

interface IFakePrisma {
  base: { $queryRaw: jest.Mock; $disconnect: jest.Mock };
}

function buildFakePrisma(): IFakePrisma {
  return {
    base: {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      $disconnect: jest.fn().mockResolvedValue(undefined),
    },
  };
}

/**
 * PrismaService caches the loaded client in a module-level variable, so each
 * test gets a fresh module registry: otherwise the first test's client would
 * answer every later `onModuleInit` and no test could observe the load.
 */
function loadService(fake: IFakePrisma): {
  service: import('./prisma.service').PrismaService;
  esmImportMock: jest.Mock;
  create: () => import('./prisma.service').PrismaService;
} {
  let loaded!: typeof import('./prisma.service');
  let esmImportMock!: jest.Mock;
  jest.isolateModules(() => {
    esmImportMock = (jest.requireMock('../utils/esm-import') as { esmImport: jest.Mock }).esmImport;
    esmImportMock.mockReset().mockResolvedValue({ prisma: fake.base as unknown as PrismaClient });
    loaded = jest.requireActual('./prisma.service');
  });
  return {
    service: new loaded.PrismaService(),
    esmImportMock,
    create: () => new loaded.PrismaService(),
  };
}

describe('PrismaService', () => {
  it('imports @repo/database through the ESM seam on init', async () => {
    const fake = buildFakePrisma();
    const { service, esmImportMock } = loadService(fake);

    await service.onModuleInit();

    expect(esmImportMock).toHaveBeenCalledTimes(1);
    expect(esmImportMock).toHaveBeenCalledWith('@repo/database');
  });

  it('exposes the loaded @repo/database client as `client`', async () => {
    const fake = buildFakePrisma();
    const { service } = loadService(fake);

    await service.onModuleInit();

    expect(service.client).toBe(fake.base);
  });

  it('probes connectivity at boot', async () => {
    const fake = buildFakePrisma();
    const { service } = loadService(fake);

    await service.onModuleInit();

    expect(fake.base.$queryRaw).toHaveBeenCalledTimes(1);
    const [strings] = fake.base.$queryRaw.mock.calls[0] as [readonly string[]];
    expect(strings.join('').trim()).toBe('SELECT 1');
  });

  it('fails startup when the database cannot be reached', async () => {
    const fake = buildFakePrisma();
    fake.base.$queryRaw.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const { service } = loadService(fake);

    await expect(service.onModuleInit()).rejects.toThrow('connect ECONNREFUSED');
  });

  it('loads the client once per process even across service instances', async () => {
    const fake = buildFakePrisma();
    const { service, esmImportMock, create } = loadService(fake);

    await service.onModuleInit();
    await create().onModuleInit();

    expect(esmImportMock).toHaveBeenCalledTimes(1);
  });

  it('disconnects the client on shutdown', async () => {
    const fake = buildFakePrisma();
    const { service } = loadService(fake);
    await service.onModuleInit();

    await service.onModuleDestroy();

    expect(fake.base.$disconnect).toHaveBeenCalledTimes(1);
  });

  it('shuts down cleanly when init never ran (nothing to disconnect)', async () => {
    const fake = buildFakePrisma();
    const { service } = loadService(fake);

    await expect(service.onModuleDestroy()).resolves.toBeUndefined();

    expect(fake.base.$disconnect).not.toHaveBeenCalled();
  });
});
