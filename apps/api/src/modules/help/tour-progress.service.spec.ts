import { TOUR_PROGRESS_MAX_ENTRIES } from '@repo/shared/schemas';
import { ConflictError } from '../../common/errors/domain-error';
import { TourProgressService } from './tour-progress.service';

type Deps = ConstructorParameters<typeof TourProgressService>;

const SAVED_AT = new Date('2026-08-28T10:00:00.000Z');
const ENTRY = { completedAt: '2026-08-01T09:00:00.000Z', version: 1, dismissed: false };

const buildSubject = () => {
  const repository = {
    // Serializes the read-modify-write; asserted to run BEFORE the read below.
    lockForUser: jest.fn().mockResolvedValue(undefined),
    find: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    update: jest.fn(),
  };
  const prismaService = {
    client: {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
    },
  };
  const service = new TourProgressService(
    prismaService as unknown as Deps[0],
    repository as unknown as Deps[1],
  );
  return { service, repository, prismaService };
};

const row = (tours: unknown) => ({ id: 'tp-1', userId: 'u-1', tours, updatedAt: SAVED_AT });

describe('TourProgressService.resolveTours (the one read seam)', () => {
  it('resolves an absent blob to an empty map, which is what every account starts as', () => {
    expect(TourProgressService.resolveTours(null)).toEqual({});
  });

  /**
   * A READ must never 500 on a value an older version wrote.
   * A tour whose stored entry is malformed is dropped; the rest of the map
   * survives. Losing one tour's "already seen" flag re-offers that tour once,
   * which is a shrug. Failing the read takes the whole help system away.
   */
  it('drops a malformed entry instead of failing the read', () => {
    expect(TourProgressService.resolveTours({ members: ENTRY, audit: { version: 'one' } })).toEqual(
      { members: ENTRY },
    );
  });

  /**
   * The specific case the acceptance criteria name. A renamed or removed tour
   * leaves a well-formed entry behind, and the SERVER keeps it: it has no
   * registry to check ids against, and inventing one would put the ninth tour
   * back into a deploy. The client ignores what it does not know.
   */
  it('does not fail on an id the client registry no longer knows', () => {
    expect(TourProgressService.resolveTours({ 'retired-screen': ENTRY })).toEqual({
      'retired-screen': ENTRY,
    });
  });
});

describe('TourProgressService.getForUser', () => {
  it('answers an empty map with no updatedAt while no row exists', async () => {
    const { service } = buildSubject();

    await expect(service.getForUser('u-1')).resolves.toEqual({ tours: {}, updatedAt: null });
  });

  it('resolves the stored blob through the seam', async () => {
    const { service, repository } = buildSubject();
    repository.find.mockResolvedValue(row({ members: ENTRY, broken: 7 }));

    await expect(service.getForUser('u-1')).resolves.toEqual({
      tours: { members: ENTRY },
      updatedAt: SAVED_AT.toISOString(),
    });
  });
});

describe('TourProgressService.saveForUser', () => {
  it('creates the row on the first tour a person ever finishes', async () => {
    const { service, repository } = buildSubject();
    repository.create.mockImplementation((_userId: string, tours: unknown) =>
      Promise.resolve(row(tours)),
    );

    const result = await service.saveForUser('u-1', {
      tourId: 'members',
      version: 2,
      dismissed: false,
    });

    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(result.tours.members).toEqual({
      completedAt: expect.any(String),
      version: 2,
      dismissed: false,
    });
  });

  /**
   * The reason a save carries ONE tour rather than the whole map: two tabs
   * finishing two different tours is an ordinary thing to do, and a wholesale
   * write would have the second one erase the first.
   */
  it('merges into what is already stored rather than replacing it', async () => {
    const { service, repository } = buildSubject();
    repository.find.mockResolvedValue(row({ dashboard: ENTRY }));
    repository.update.mockImplementation((_id: string, tours: unknown) =>
      Promise.resolve(row(tours)),
    );

    const result = await service.saveForUser('u-1', {
      tourId: 'members',
      version: 1,
      dismissed: true,
    });

    expect(Object.keys(result.tours).sort()).toEqual(['dashboard', 'members']);
    expect(result.tours.dashboard).toEqual(ENTRY);
    expect(result.tours.members?.dismissed).toBe(true);
  });

  /**
   * The merge is a read-modify-write, so without the lock two tabs finishing
   * two different tours in the same second each read `{}`, each write their own
   * single entry, and the last commit forgets the other tour, which is then
   * auto-offered again.
   */
  it('locks the user before reading the map it is about to merge into', async () => {
    const { service, repository } = buildSubject();
    repository.create.mockImplementation((_userId: string, tours: unknown) =>
      Promise.resolve(row(tours)),
    );

    await service.saveForUser('u-1', { tourId: 'members', version: 1, dismissed: false });

    expect(repository.lockForUser).toHaveBeenCalledWith('u-1', {});
    expect(repository.lockForUser.mock.invocationCallOrder[0]).toBeLessThan(
      repository.find.mock.invocationCallOrder[0]!,
    );
  });

  it('stamps completedAt server-side rather than trusting a client clock', async () => {
    const { service, repository } = buildSubject();
    repository.create.mockImplementation((_userId: string, tours: unknown) =>
      Promise.resolve(row(tours)),
    );

    const result = await service.saveForUser('u-1', {
      tourId: 'members',
      version: 1,
      dismissed: false,
    });

    expect(Date.parse(result.tours.members!.completedAt)).not.toBeNaN();
  });

  it('caps the blob, dropping the oldest entries first', async () => {
    const { service, repository } = buildSubject();
    const stored = Object.fromEntries(
      Array.from({ length: TOUR_PROGRESS_MAX_ENTRIES }, (_unused, index) => [
        `tour-${index}`,
        // Oldest first, so `tour-0` is the one that must go.
        { ...ENTRY, completedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString() },
      ]),
    );
    repository.find.mockResolvedValue(row(stored));
    repository.update.mockImplementation((_id: string, tours: unknown) =>
      Promise.resolve(row(tours)),
    );

    const result = await service.saveForUser('u-1', {
      tourId: 'newest',
      version: 1,
      dismissed: false,
    });

    expect(Object.keys(result.tours)).toHaveLength(TOUR_PROGRESS_MAX_ENTRIES);
    expect(result.tours.newest).toBeDefined();
    expect(result.tours['tour-0']).toBeUndefined();
  });

  it('translates the first-save race into a retryable conflict', async () => {
    const { service, prismaService } = buildSubject();
    prismaService.client.$transaction.mockRejectedValue(
      Object.assign(new Error('unique'), { name: 'PrismaClientKnownRequestError', code: 'P2002' }),
    );

    await expect(
      service.saveForUser('u-1', { tourId: 'members', version: 1, dismissed: false }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('TourProgressService.resetForUser', () => {
  it('is a no-op for a user who has never seen a tour', async () => {
    const { service, repository } = buildSubject();

    await expect(service.resetForUser('u-1')).resolves.toEqual({ tours: {}, updatedAt: null });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('empties the map so every tour is offered again', async () => {
    const { service, repository } = buildSubject();
    repository.find.mockResolvedValue(row({ members: ENTRY }));
    repository.update.mockImplementation((_id: string, tours: unknown) =>
      Promise.resolve(row(tours)),
    );

    await expect(service.resetForUser('u-1')).resolves.toEqual({
      tours: {},
      updatedAt: SAVED_AT.toISOString(),
    });
    expect(repository.update).toHaveBeenCalledWith('tp-1', {});
  });
});
