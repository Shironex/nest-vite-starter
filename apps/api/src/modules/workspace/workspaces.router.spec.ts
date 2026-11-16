import { WorkspacesRouter } from './workspaces.router';

type Services = ConstructorParameters<typeof WorkspacesRouter>;

const buildRouter = () => {
  const workspaceService = {
    list: jest.fn().mockResolvedValue({ workspaces: [] }),
    create: jest.fn().mockResolvedValue({ id: 'f-1', name: 'Northwind' }),
    update: jest.fn().mockResolvedValue({ id: 'f-1', name: 'Northwind' }),
  };
  const router = new WorkspacesRouter(workspaceService as unknown as Services[0]);
  return { router, workspaceService };
};

describe('WorkspacesRouter (wiring)', () => {
  it('list() delegates to the service', async () => {
    const { router, workspaceService } = buildRouter();
    await expect(router.list()).resolves.toEqual({ workspaces: [] });
    expect(workspaceService.list).toHaveBeenCalledWith();
  });

  it('create() passes the whole input through, registration fields included', async () => {
    const { router, workspaceService } = buildRouter();
    await router.create({ name: 'Northwind', city: 'Springfield' });
    expect(workspaceService.create).toHaveBeenCalledWith({
      name: 'Northwind',
      city: 'Springfield',
    });
  });

  it('update() passes the whole input through', async () => {
    const { router, workspaceService } = buildRouter();
    await router.update({ workspaceId: 'f-1', city: null });
    expect(workspaceService.update).toHaveBeenCalledWith({ workspaceId: 'f-1', city: null });
  });

  // Audit A1: the statutory legal name reaches the service on both write paths.
  // The router is a pass-through, so this is cheap, but the field had no path
  // at all for 23 days, and a pass-through is exactly where that goes unnoticed.
  it('carries legalName to the service on create and on update', async () => {
    const { router, workspaceService } = buildRouter();
    await router.create({ name: 'Northwind', legalName: 'Northwind Ltd' });
    expect(workspaceService.create).toHaveBeenCalledWith({
      name: 'Northwind',
      legalName: 'Northwind Ltd',
    });

    await router.update({ workspaceId: 'f-1', legalName: 'Northwind S.A.' });
    expect(workspaceService.update).toHaveBeenCalledWith({
      workspaceId: 'f-1',
      legalName: 'Northwind S.A.',
    });
  });
});
