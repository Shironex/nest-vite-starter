import { HelpRouter } from './help.router';

type Services = ConstructorParameters<typeof HelpRouter>;

const EMPTY = { tours: {}, updatedAt: null };

const buildRouter = () => {
  const tourProgressService = {
    getForUser: jest.fn().mockResolvedValue(EMPTY),
    saveForUser: jest.fn().mockResolvedValue(EMPTY),
    resetForUser: jest.fn().mockResolvedValue(EMPTY),
  };
  const router = new HelpRouter(tourProgressService as unknown as Services[0]);
  return { router, tourProgressService };
};

const buildCtx = (userId = 'u-1') =>
  ({
    req: {} as unknown,
    res: {} as unknown,
    user: { id: userId, email: 'e', role: 'USER', emailVerified: true },
    session: { id: 's-1', token: 'tok' },
  }) as unknown as Parameters<HelpRouter['progressGet']>[0];

describe('HelpRouter (wiring)', () => {
  it('progressGet() delegates with the caller id', async () => {
    const { router, tourProgressService } = buildRouter();

    await expect(router.progressGet(buildCtx('u-9'))).resolves.toEqual(EMPTY);

    expect(tourProgressService.getForUser).toHaveBeenCalledWith('u-9');
  });

  /**
   * The input names a TOUR, never a user. This assertion is the one that keeps
   * it that way: the day somebody adds a `userId` to the save input, the
   * delegation stops matching and this fails.
   */
  it('progressSave() scopes by the CALLER id from ctx, never from input', async () => {
    const { router, tourProgressService } = buildRouter();
    const input = { tourId: 'members', version: 1, dismissed: false };

    await router.progressSave(buildCtx('u-2'), input);

    expect(tourProgressService.saveForUser).toHaveBeenCalledWith('u-2', input);
  });

  it('progressResetAll() delegates with the caller id', async () => {
    const { router, tourProgressService } = buildRouter();

    await router.progressResetAll(buildCtx('u-3'));

    expect(tourProgressService.resetForUser).toHaveBeenCalledWith('u-3');
  });
});
