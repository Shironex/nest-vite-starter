/**
 * Fast-lane unit spec for the tenant-scope extension.
 *
 * The live-DB proof of tenant isolation lives in `tenant-isolation.isolation.spec.ts`
 * (integration lane, real Postgres). This spec needs no database: it drives the
 * `$allOperations` hook directly with a stub `query` callback, so it runs in the
 * default jest lane on every CI job.
 *
 * Its primary job is a regression pin. The extension must run EVERY scoped
 * operation through the `query` callback Prisma supplies, because that callback
 * is bound to the client the call arrived on. An earlier version rewrote the
 * singular ops (findUnique / findUniqueOrThrow / update / delete) onto delegates
 * captured from the root client, which silently moved them off any enclosing
 * interactive transaction: writes autocommitted and survived a rollback, and
 * reads could not see the transaction's own uncommitted rows. Asserting that
 * `query` is invoked for every operation catches a reintroduction of that shape
 * without needing a live database.
 */
import { requestContext } from '../context/request-context';
import { buildTenantScopeExtension } from './tenant-scope.extension';

type QueryStub = jest.Mock<Promise<unknown>, [unknown]>;

type AllOperationsHook = (params: {
  model?: string;
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
}) => Promise<unknown>;

const TENANT_ID = 'tenant-alpha';
const OTHER_TENANT_ID = 'tenant-beta';

const hook = (
  buildTenantScopeExtension() as unknown as {
    query: { $allOperations: AllOperationsHook };
  }
).query.$allOperations;

/** Run `fn` with a tenant in the ALS, the way the auth middleware would. */
const withTenant = <T>(fn: () => Promise<T>, tenantId: string = TENANT_ID): Promise<T> =>
  requestContext.run({ requestId: 'unit-test', tenantId }, fn);

const makeQuery = (): QueryStub => jest.fn().mockResolvedValue('result') as QueryStub;

/** Invoke the hook for a scoped model (Workspace) and return the stub it called. */
const callScoped = async (
  operation: string,
  args: unknown,
  tenantId: string = TENANT_ID,
): Promise<QueryStub> => {
  const query = makeQuery();
  await withTenant(() => hook({ model: 'Workspace', operation, args, query }), tenantId);
  return query;
};

/** Every operation the extension explicitly handles for a scoped model. */
const HANDLED_OPERATIONS: ReadonlyArray<[operation: string, args: unknown]> = [
  ['findMany', { where: { name: 'a' } }],
  ['findFirst', { where: { name: 'a' } }],
  ['findFirstOrThrow', { where: { name: 'a' } }],
  ['count', {}],
  ['aggregate', {}],
  ['groupBy', { by: ['name'] }],
  ['deleteMany', { where: { name: 'a' } }],
  ['findUnique', { where: { id: 'workspace-1' } }],
  ['findUniqueOrThrow', { where: { id: 'workspace-1' } }],
  ['delete', { where: { id: 'workspace-1' } }],
  ['update', { where: { id: 'workspace-1' }, data: { name: 'renamed' } }],
  ['updateMany', { where: { id: 'workspace-1' }, data: { name: 'renamed' } }],
  ['create', { data: { name: 'new' } }],
  ['createMany', { data: [{ name: 'new' }] }],
  [
    'upsert',
    { where: { id: 'workspace-1' }, create: { name: 'new' }, update: { name: 'renamed' } },
  ],
];

describe('tenant-scope extension', () => {
  describe('transaction binding (regression pin)', () => {
    it.each(HANDLED_OPERATIONS)(
      'routes %s through the supplied query callback',
      async (operation, args) => {
        const query = await callScoped(operation, args);
        // If this fails, the operation was executed on some other client (e.g. a
        // captured root-client delegate) and would escape an enclosing
        // $transaction. See the file header.
        expect(query).toHaveBeenCalledTimes(1);
      },
    );

    it('never resolves a scoped operation without invoking query', async () => {
      // Belt-and-braces over the it.each above: proves no handled operation can
      // return a value produced outside the query callback.
      for (const [operation, args] of HANDLED_OPERATIONS) {
        const query = makeQuery();
        const result = await withTenant(() => hook({ model: 'Workspace', operation, args, query }));
        expect(result).toBe('result');
        expect(query).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe('scope injection', () => {
    it.each(['findUnique', 'findUniqueOrThrow', 'delete'])(
      'merges the scope key into the where-unique for %s',
      async (operation) => {
        const query = await callScoped(operation, { where: { id: 'workspace-1' } });
        expect(query).toHaveBeenCalledWith({ where: { id: 'workspace-1', tenantId: TENANT_ID } });
      },
    );

    it('merges the scope key into a filtered read', async () => {
      const query = await callScoped('findMany', { where: { name: 'northwind' } });
      expect(query).toHaveBeenCalledWith({ where: { name: 'northwind', tenantId: TENANT_ID } });
    });

    it('stamps the scope key onto create', async () => {
      const query = await callScoped('create', { data: { name: 'new' } });
      expect(query).toHaveBeenCalledWith({ data: { name: 'new', tenantId: TENANT_ID } });
    });

    it('stamps the scope key onto every createMany row', async () => {
      const query = await callScoped('createMany', { data: [{ name: 'a' }, { name: 'b' }] });
      expect(query).toHaveBeenCalledWith({
        data: [
          { name: 'a', tenantId: TENANT_ID },
          { name: 'b', tenantId: TENANT_ID },
        ],
      });
    });
  });

  describe('cross-scope donation is impossible', () => {
    it('strips a client-supplied scope key from update data', async () => {
      const query = await callScoped('update', {
        where: { id: 'workspace-1' },
        data: { name: 'renamed', tenantId: OTHER_TENANT_ID },
      });
      expect(query).toHaveBeenCalledWith({
        where: { id: 'workspace-1', tenantId: TENANT_ID },
        data: { name: 'renamed' },
      });
    });

    it('strips a client-supplied scope key from updateMany data', async () => {
      const query = await callScoped('updateMany', {
        where: { id: 'workspace-1' },
        data: { name: 'renamed', tenantId: OTHER_TENANT_ID },
      });
      expect(query).toHaveBeenCalledWith({
        where: { id: 'workspace-1', tenantId: TENANT_ID },
        data: { name: 'renamed' },
      });
    });

    it('overrides a client-supplied scope key in the where and on create', async () => {
      const query = await callScoped('upsert', {
        where: { id: 'workspace-1', tenantId: OTHER_TENANT_ID },
        create: { name: 'new', tenantId: OTHER_TENANT_ID },
        update: { name: 'renamed', tenantId: OTHER_TENANT_ID },
      });
      expect(query).toHaveBeenCalledWith({
        where: { id: 'workspace-1', tenantId: TENANT_ID },
        create: { name: 'new', tenantId: TENANT_ID },
        update: { name: 'renamed' },
      });
    });

    it('overrides a client-supplied scope key in a read where', async () => {
      const query = await callScoped('findMany', { where: { tenantId: OTHER_TENANT_ID } });
      expect(query).toHaveBeenCalledWith({ where: { tenantId: TENANT_ID } });
    });

    // The scalar strip alone is not enough: `tenantId` is also writable through
    // the `tenant` relation, which singular `update` exposes (`updateMany` does
    // not - its payload type carries no relation fields). Rejecting the relation
    // write is what stops `data: { tenant: { connect } }` moving a row out of
    // the active scope.
    const relationWrites: ReadonlyArray<[label: string, operation: string, args: unknown]> = [
      [
        'update data',
        'update',
        { where: { id: 'workspace-1' }, data: { tenant: { connect: { id: OTHER_TENANT_ID } } } },
      ],
      [
        'updateMany data',
        'updateMany',
        { where: { id: 'workspace-1' }, data: { tenant: { connect: { id: OTHER_TENANT_ID } } } },
      ],
      [
        'create data',
        'create',
        { data: { name: 'new', tenant: { connect: { id: OTHER_TENANT_ID } } } },
      ],
      [
        'createMany row',
        'createMany',
        { data: [{ name: 'ok' }, { name: 'bad', tenant: { connect: { id: OTHER_TENANT_ID } } }] },
      ],
      [
        'upsert create branch',
        'upsert',
        {
          where: { id: 'workspace-1' },
          create: { tenant: { connect: { id: OTHER_TENANT_ID } } },
          update: {},
        },
      ],
      [
        'upsert update branch',
        'upsert',
        {
          where: { id: 'workspace-1' },
          create: { name: 'new' },
          update: { tenant: { connect: { id: OTHER_TENANT_ID } } },
        },
      ],
    ];

    it.each(relationWrites)(
      'rejects a scope-relation write in %s',
      async (_label, operation, args) => {
        const query = makeQuery();
        await expect(
          withTenant(() => hook({ model: 'Workspace', operation, args, query })),
        ).rejects.toThrow("may not target the 'tenant' relation");
        // Fail before touching the database, not after.
        expect(query).not.toHaveBeenCalled();
      },
    );

    it.each(['connect', 'create', 'connectOrCreate', 'update', 'upsert'])(
      'rejects the scope relation regardless of the nested verb (%s)',
      async (verb) => {
        const query = makeQuery();
        await expect(
          withTenant(() =>
            hook({
              model: 'Workspace',
              operation: 'update',
              args: {
                where: { id: 'workspace-1' },
                data: { tenant: { [verb]: { id: OTHER_TENANT_ID } } },
              },
              query,
            }),
          ),
        ).rejects.toThrow("may not target the 'tenant' relation");
        expect(query).not.toHaveBeenCalled();
      },
    );

    it('allows a nested write on a relation that does not own a scope key', async () => {
      const query = await callScoped('update', {
        where: { id: 'workspace-1' },
        data: { name: 'renamed', notes: { create: [{ body: 'doe' }] } },
      });
      expect(query).toHaveBeenCalledWith({
        where: { id: 'workspace-1', tenantId: TENANT_ID },
        data: { name: 'renamed', notes: { create: [{ body: 'doe' }] } },
      });
    });
  });

  describe('fail-closed', () => {
    it('throws when no request context exists at all', async () => {
      const query = makeQuery();
      await expect(
        hook({ model: 'Workspace', operation: 'findMany', args: {}, query }),
      ).rejects.toThrow('Tenant context required');
      expect(query).not.toHaveBeenCalled();
    });

    it('throws when the context carries no tenantId', async () => {
      const query = makeQuery();
      await expect(
        requestContext.run({ requestId: 'unit-test' }, () =>
          hook({ model: 'Workspace', operation: 'findMany', args: {}, query }),
        ),
      ).rejects.toThrow('Tenant context required');
      expect(query).not.toHaveBeenCalled();
    });

    it('throws on an operation the switch does not enumerate', async () => {
      const query = makeQuery();
      await expect(
        withTenant(() =>
          hook({ model: 'Workspace', operation: 'someFuturePrismaOp', args: {}, query }),
        ),
      ).rejects.toThrow("unhandled workspace operation 'someFuturePrismaOp'");
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('pass-through', () => {
    it('leaves an unscoped model untouched and requires no tenant context', async () => {
      const query = makeQuery();
      const args = { where: { id: 'user-1' } };
      await hook({ model: 'User', operation: 'findUnique', args, query });
      expect(query).toHaveBeenCalledWith(args);
    });

    it('leaves a raw query (no model) untouched', async () => {
      const query = makeQuery();
      const args = ['SELECT 1'];
      await hook({ operation: '$queryRaw', args, query });
      expect(query).toHaveBeenCalledWith(args);
    });

    it('maps the PascalCase model name to the camelCase accessor', async () => {
      // TwoFactorPolicy -> twoFactorPolicy must resolve as scoped, not pass through.
      const query = makeQuery();
      await withTenant(() =>
        hook({ model: 'TwoFactorPolicy', operation: 'findMany', args: {}, query }),
      );
      expect(query).toHaveBeenCalledWith({ where: { tenantId: TENANT_ID } });
    });
  });
});
