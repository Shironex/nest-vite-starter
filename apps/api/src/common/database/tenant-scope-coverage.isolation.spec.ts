/**
 * One cross-tenant case per isolated model.
 *
 * The isolation canary (`pnpm canary:isolation`) rebuilds the extended client
 * from the production model registry MINUS one model and requires the lane to go
 * red. A model whose every case goes through a service that filters by tenant
 * anyway never asks the extension a question, so it could be dropped from
 * `TENANT_SCOPED_MODELS` with the whole suite staying green.
 *
 * So this spec asks the extension directly, once per model, through the same
 * generic pair of questions: a row belonging to tenant A must be invisible under
 * tenant B's scope, and a read with no tenant in context must fail closed. Both
 * are questions only the extension can answer, which is what makes the mutant
 * for every model die here.
 *
 * `createScopedRows` must create a row for EVERY key of `TENANT_SCOPED_MODELS`
 * (asserted below), so a model added to the runtime boundary arrives with a
 * killing case rather than a silent gap.
 *
 * Runs against the LIVE docker Postgres via the integration config, like the
 * rest of the lane. See tenant-isolation.isolation.spec.ts for the setup notes.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@repo/database' with { 'resolution-mode': 'import' };
import { buildCanaryTenantScopeExtension } from '@test/tenant-scope-canary';
import { esmImport } from '../utils/esm-import';
import { requestContext } from '../context/request-context';
import { TENANT_SCOPED_MODELS } from './tenant-scope.extension';

/** The one delegate method every case below calls, model-agnostically. */
interface IFindFirstDelegate {
  findFirst(args: { where: { id: string } }): Promise<{ id: string } | null>;
}

/** Ids of the fixture rows one tenant's chain is built from. */
interface IFixtureContext {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly userId: string;
}

let unscoped: PrismaClient;
let client: PrismaClient;

const createdTenantIds: string[] = [];
/** Model accessor -> the id of tenant A's row of that model. */
let rowIds: Record<string, string> = {};
let tenantB: { id: string };

const run = (tenantId: string | undefined, fn: () => Promise<void>): Promise<void> =>
  requestContext.run({ requestId: 'iso-coverage', tenantId }, fn);

/** The model delegate, keyed by accessor: the shape the extension dispatches on. */
const delegate = (on: PrismaClient, model: string): IFindFirstDelegate => {
  const found = (on as unknown as Record<string, IFindFirstDelegate | undefined>)[model];
  if (found === undefined) {
    throw new Error(`No Prisma delegate named "${model}": the registry and the client disagree.`);
  }
  return found;
};

/** Tenant A's row of `model`, or a loud failure instead of an undefined id. */
const rowIdOf = (model: string): string => {
  const id = rowIds[model];
  if (id === undefined) {
    throw new Error(`createScopedRows created no row for "${model}".`);
  }
  return id;
};

/** Tenant + workspace + user: everything the scoped rows hang off. */
async function createTenantChain(label: string): Promise<IFixtureContext> {
  const uid = randomUUID();
  const tenant = await unscoped.tenant.create({
    data: { name: `iso-cov-${label}-${uid}`, slug: `iso-cov-${label}-${uid}` },
  });
  createdTenantIds.push(tenant.id);
  const workspace = await unscoped.workspace.create({
    data: { name: `iso-cov-workspace-${uid}`, tenantId: tenant.id },
  });
  const user = await unscoped.user.create({
    data: { email: `iso-cov-${uid}@example.test`, tenantId: tenant.id },
  });
  return { tenantId: tenant.id, workspaceId: workspace.id, userId: user.id };
}

/**
 * One row of every model in `TENANT_SCOPED_MODELS`, written through the UNSCOPED
 * client so the fixtures themselves are not subject to the boundary under test.
 */
async function createScopedRows(ctx: IFixtureContext): Promise<Record<string, string>> {
  const { tenantId } = ctx;
  const uid = randomUUID();

  const workspace = await unscoped.workspace.create({
    data: { name: `iso-cov-second-workspace-${uid}`, tenantId },
  });
  return {
    workspace: workspace.id,
  };
}

beforeAll(async () => {
  const { prisma } = (await esmImport('@repo/database')) as { prisma: PrismaClient };
  unscoped = prisma;
  client = unscoped.$extends(buildCanaryTenantScopeExtension()) as unknown as PrismaClient;

  const tenantA = await createTenantChain('a');
  rowIds = await createScopedRows(tenantA);
  tenantB = { id: (await createTenantChain('b')).tenantId };
});

afterAll(async () => {
  // Children before parents; every fixture row carries one of the two tenants.
  const where = { tenantId: { in: createdTenantIds } };
  await unscoped.user.deleteMany({ where });
  await unscoped.workspace.deleteMany({ where });
  await unscoped.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
  await unscoped?.$disconnect();
});

describe('every model the extension isolates has a cross-tenant case', () => {
  it('C0 the fixtures cover the whole registry, so a new scoped model cannot skip this file', () => {
    expect(Object.keys(rowIds).sort()).toEqual(Object.keys(TENANT_SCOPED_MODELS).sort());
  });

  describe.each(Object.keys(TENANT_SCOPED_MODELS))('%s', (model) => {
    it('C1 a row of tenant A is invisible to a scoped read under tenant B', async () => {
      await run(tenantB.id, async () => {
        await expect(
          delegate(client, model).findFirst({ where: { id: rowIdOf(model) } }),
        ).resolves.toBeNull();
      });
    });

    it('C2 fails closed when there is no tenant in context', async () => {
      await run(undefined, async () => {
        await expect(
          delegate(client, model).findFirst({ where: { id: rowIdOf(model) } }),
        ).rejects.toThrow();
      });
    });
  });
});
