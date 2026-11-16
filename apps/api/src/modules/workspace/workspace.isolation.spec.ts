/**
 * The platform Workspace module against the LIVE Postgres, through the real
 * tenant-scope extension.
 *
 *   pnpm sandbox:up
 *   export DATABASE_URL="$(pnpm sandbox:inspect --lane-url=isolation | tail -n 1)"
 *   pnpm --filter @repo/api test:integration
 *
 * Workspace is the second tier of the Organization -> Workspace boundary. What only this lane
 * can show: the list stays inside one organization, the per-organization unique name
 * constraint is per-organization and not global, and a Workspace of another organization is
 * indistinguishable from a missing one, both to the write path and to the gate
 * every domain module calls before accepting a caller-supplied workspaceId.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@repo/database' with { 'resolution-mode': 'import' };
import { AppErrorCode } from '@repo/shared/errors';
import { esmImport } from '../../common/utils/esm-import';
import { requestContext } from '../../common/context/request-context';
import { buildCanaryTenantScopeExtension } from '@test/tenant-scope-canary';
import { expectRejectsDomainError } from '@test/domain-error-matchers';
import { NotFoundError } from '../../common/errors/domain-error';
import type { PrismaService } from '../../common/database/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { WorkspaceRepository } from './workspace.repository';
import { WorkspaceService } from './workspace.service';
import { WorkspaceLookupService } from './workspace-lookup.service';

let unscoped: PrismaClient;
let client: PrismaClient;
let workspaceService: WorkspaceService;
let workspaceLookup: WorkspaceLookupService;

const createdTenantIds = new Set<string>();

let tenantA: { id: string };
let tenantB: { id: string };
let workspaceA1: { id: string };
let workspaceA2: { id: string };
let workspaceB: { id: string };

/** The `await fn()` defeats Prisma promise laziness: a Prisma query is lazy, so
 * returning it un-awaited would run it after `requestContext.run` has exited. */
const run = <T>(tenantId: string | undefined, fn: () => Promise<T>): Promise<T> =>
  requestContext.run({ requestId: 'workspace-iso', tenantId }, async () => await fn());

beforeAll(async () => {
  const { prisma } = (await esmImport('@repo/database')) as { prisma: PrismaClient };
  unscoped = prisma;
  client = unscoped.$extends(buildCanaryTenantScopeExtension()) as unknown as PrismaClient;

  const uid = randomUUID();
  tenantA = await unscoped.tenant.create({ data: { name: `fi-a-${uid}`, slug: `fi-a-${uid}` } });
  tenantB = await unscoped.tenant.create({ data: { name: `fi-b-${uid}`, slug: `fi-b-${uid}` } });
  createdTenantIds.add(tenantA.id);
  createdTenantIds.add(tenantB.id);

  workspaceA1 = await unscoped.workspace.create({
    data: { tenantId: tenantA.id, name: `fa1-${uid}` },
  });
  workspaceA2 = await unscoped.workspace.create({
    data: { tenantId: tenantA.id, name: `fa2-${uid}` },
  });
  workspaceB = await unscoped.workspace.create({
    data: { tenantId: tenantB.id, name: `fb-${uid}` },
  });

  const prismaService = { client, unscoped } as unknown as PrismaService;
  const repository = new WorkspaceRepository(prismaService);
  const audit = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  workspaceService = new WorkspaceService(repository, audit);
  workspaceLookup = new WorkspaceLookupService(repository);
});

afterAll(async () => {
  for (const tenantId of createdTenantIds) {
    await unscoped.workspace.deleteMany({ where: { tenantId } });
    await unscoped.tenant.delete({ where: { id: tenantId } });
  }
  await unscoped.$disconnect();
});

describe('workspaces list (the picker every Workspace screen reads)', () => {
  it("R0: lists only the own organization's workspaces, and a created one joins them", async () => {
    const name = `R0-${randomUUID()}`;
    const created = await run(tenantA.id, () => workspaceService.create({ name }));

    const forA = await run(tenantA.id, () => workspaceService.list());
    const idsA = forA.workspaces.map((workspace) => workspace.id);
    expect(idsA).toEqual(expect.arrayContaining([workspaceA1.id, workspaceA2.id, created.id]));
    expect(idsA).not.toContain(workspaceB.id);

    const forB = await run(tenantB.id, () => workspaceService.list());
    const idsB = forB.workspaces.map((workspace) => workspace.id);
    expect(idsB).toContain(workspaceB.id);
    expect(idsB).not.toContain(created.id);
  });

  it('R0b: the same workspace name is free again under a different organization', async () => {
    // @@unique([tenantId, name]) is per-organization, not global: two
    // organizations routinely name their workspaces the same way.
    const shared = `R0b-${randomUUID()}`;
    const inA = await run(tenantA.id, () => workspaceService.create({ name: shared }));
    const inB = await run(tenantB.id, () => workspaceService.create({ name: shared }));

    expect(inA.id).not.toBe(inB.id);
    await expect(
      run(tenantA.id, () => workspaceService.create({ name: shared })),
    ).rejects.toThrow();
  });

  it("R0c: editing another organization's Workspace resolves to not found", async () => {
    const inB = await run(tenantB.id, () =>
      workspaceService.create({ name: `R0c-b-${randomUUID()}` }),
    );

    // Editing the OTHER organization's Workspace from tenant A resolves to nothing: the
    // scoped read makes a foreign id indistinguishable from a missing one.
    await expect(
      run(tenantA.id, () => workspaceService.update({ workspaceId: inB.id, city: 'Springfield' })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('the Workspace gate other modules call before trusting a workspaceId', () => {
  it("F1: refuses another organization's Workspace exactly like a missing one, and passes the own", async () => {
    await expect(
      run(tenantA.id, () => workspaceLookup.assertInTenant(workspaceA1.id)),
    ).resolves.toBe(undefined);
    await expectRejectsDomainError(
      run(tenantA.id, () => workspaceLookup.assertInTenant(workspaceB.id)),
      {
        type: NotFoundError,
        appCode: AppErrorCode.NOT_FOUND,
        message: 'Workspace not found in this tenant.',
      },
    );
    await expectRejectsDomainError(
      run(tenantA.id, () => workspaceLookup.assertInTenant(randomUUID())),
      {
        type: NotFoundError,
        appCode: AppErrorCode.NOT_FOUND,
        message: 'Workspace not found in this tenant.',
      },
    );
  });

  it("F2: lists the own organization's Workspaces only", async () => {
    const ids = (await run(tenantB.id, () => workspaceLookup.list())).map(
      (workspace) => workspace.id,
    );
    expect(ids).toContain(workspaceB.id);
    expect(ids).not.toContain(workspaceA1.id);
    expect(ids).not.toContain(workspaceA2.id);
  });
});
