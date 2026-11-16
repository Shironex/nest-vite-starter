import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { AppErrorCode } from '@repo/shared/errors';
import { workspaceCreateInput, workspaceUpdateInput } from '@repo/shared/schemas';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../../common/database/prisma.service';
import { buildPrismaMock } from '@test/test-module';
import type { PrismaServiceMock } from '@test/test-module';
import { requestContext } from '../../common/context/request-context';
import { ConflictError, NotFoundError } from '../../common/errors/domain-error';
import { WorkspaceRepository } from './workspace.repository';
import { WorkspaceService } from './workspace.service';

const TENANT = 't-1';

/** Every column the workspaces router serves; the repository selects exactly this. */
const WORKSPACE_SELECT = {
  id: true,
  name: true,
  legalName: true,
  street: true,
  postalCode: true,
  city: true,
};

/** A full Workspace row as the select returns it, defaults overridable per test. */
const workspaceRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'f-1',
  name: 'Northwind',
  legalName: null,
  street: null,
  postalCode: null,
  city: null,
  ...overrides,
});

interface ISubject {
  service: WorkspaceService;
  prisma: PrismaServiceMock;
  audit: { log: jest.Mock };
}

const buildSubject = (): ISubject => {
  const prisma = buildPrismaMock();
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const repository = new WorkspaceRepository(prisma as unknown as PrismaService);
  const service = new WorkspaceService(repository, audit as unknown as AuditService);
  return { service, prisma, audit };
};

const inTenant = <T>(fn: () => Promise<T>): Promise<T> =>
  requestContext.run({ requestId: 'spec', tenantId: TENANT }, async () => await fn());

// `@repo/database` is ESM-only and cannot be imported at runtime here, so
// rejections are duck-typed the same way isPrismaUniqueViolation reads them.
const uniqueViolation = (target: string[]) =>
  Object.assign(new Error('duplicate'), { code: 'P2002', meta: { target } });

/**
 * A column the product can never write, and how it survives a green suite.
 *
 * `Workspace.legalName` is the registered legal name. Nothing asserted that a Workspace
 * created through the product could ever carry one: `legalName` was missing
 * from workspaceCreateInput, from WorkspaceService and from the dialog, and the e2e
 * lane that would have caught it was immunized by its own fixture setting the
 * column directly.
 *
 * These cases close that gap from the reachable side. They drive the REAL
 * `workspaceCreateInput` / `workspaceUpdateInput` rather than a hand-built object, so
 * dropping the field from the wire schema (zod would silently strip it), from
 * the service, or from the repository select fails here. Do not replace the schema parse with a literal.
 */
describe('WorkspaceService: the statutory legal name is reachable (audit A1)', () => {
  const LEGAL_NAME = 'Northwind Traders Limited';

  it('persists a legalName supplied through workspaceCreateInput, non-null', async () => {
    const { service, prisma } = buildSubject();
    const created = workspaceRow({ id: 'f-9', legalName: LEGAL_NAME });
    prisma.client.workspace.create.mockResolvedValue(created);

    // Through the wire schema, exactly as the router feeds the service.
    const input = workspaceCreateInput.parse({ name: 'Northwind', legalName: `  ${LEGAL_NAME}  ` });
    const result = await inTenant(() => service.create(input));

    const written = prisma.client.workspace.create.mock.calls[0][0].data as { legalName: unknown };
    expect(written.legalName).toBe(LEGAL_NAME);
    expect(result.legalName).toBe(LEGAL_NAME);

    // The precondition filing actually applies, asserted here in the satisfied
    // direction: present, and not blank once trimmed.
    expect(result.legalName).not.toBeNull();
    expect((result.legalName ?? '').trim()).not.toBe('');
  });

  it('lets update set a legalName on a Workspace created without one', async () => {
    const { service, prisma } = buildSubject();
    prisma.client.workspace.findUnique.mockResolvedValue({ id: 'f-1' });
    prisma.client.workspace.update.mockResolvedValue(workspaceRow({ legalName: LEGAL_NAME }));

    const input = workspaceUpdateInput.parse({ workspaceId: 'f-1', legalName: LEGAL_NAME });
    const result = await inTenant(() => service.update(input));

    expect(prisma.client.workspace.update).toHaveBeenCalledWith({
      where: { id: 'f-1' },
      data: { legalName: LEGAL_NAME },
      select: WORKSPACE_SELECT,
    });
    expect(result.legalName).toBe(LEGAL_NAME);
  });

  it('returns legalName on the list rows too, so the dialog can seed an edit', async () => {
    const { service, prisma } = buildSubject();
    prisma.client.workspace.findMany.mockResolvedValue([workspaceRow({ legalName: LEGAL_NAME })]);

    // The column is only editable if the read that seeds the form carries it,
    // which is the same select create and update return.
    await expect(service.list()).resolves.toEqual({
      workspaces: [expect.objectContaining({ legalName: LEGAL_NAME })],
    });
    expect(prisma.client.workspace.findMany).toHaveBeenCalledWith({
      select: expect.objectContaining({ legalName: true }),
      orderBy: { name: 'asc' },
    });
  });

  it('clears legalName with an explicit null, the sibling-field convention', async () => {
    const { service, prisma } = buildSubject();
    prisma.client.workspace.findUnique.mockResolvedValue({ id: 'f-1' });
    prisma.client.workspace.update.mockResolvedValue(workspaceRow());

    await inTenant(() =>
      service.update(workspaceUpdateInput.parse({ workspaceId: 'f-1', legalName: null })),
    );

    expect(prisma.client.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { legalName: null } }),
    );
  });

  it('leaves legalName untouched when the key is absent', async () => {
    const { service, prisma } = buildSubject();
    prisma.client.workspace.findUnique.mockResolvedValue({ id: 'f-1' });
    prisma.client.workspace.update.mockResolvedValue(workspaceRow());

    await inTenant(() =>
      service.update(workspaceUpdateInput.parse({ workspaceId: 'f-1', name: 'Beta' })),
    );

    const data = prisma.client.workspace.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data).not.toHaveProperty('legalName');
  });
});

describe('WorkspaceService', () => {
  describe('list', () => {
    it('wraps the rows in the output envelope, name-ascending', async () => {
      const { service, prisma } = buildSubject();
      const rows = [workspaceRow(), workspaceRow({ id: 'f-2', name: 'Beta' })];
      prisma.client.workspace.findMany.mockResolvedValue(rows);

      await expect(service.list()).resolves.toEqual({ workspaces: rows });
      expect(prisma.client.workspace.findMany).toHaveBeenCalledWith({
        select: WORKSPACE_SELECT,
        orderBy: { name: 'asc' },
      });
    });

    it('answers with an empty list rather than throwing on a fresh organization', async () => {
      const { service, prisma } = buildSubject();
      prisma.client.workspace.findMany.mockResolvedValue([]);

      await expect(service.list()).resolves.toEqual({ workspaces: [] });
    });
  });

  describe('create', () => {
    it('stamps the caller tenant, stores the registration data and audits the new row', async () => {
      const { service, prisma, audit } = buildSubject();
      const created = workspaceRow({ id: 'f-9', city: 'Springfield' });
      prisma.client.workspace.create.mockResolvedValue(created);

      const result = await inTenant(() =>
        service.create({ name: 'Northwind', city: 'Springfield' }),
      );

      expect(result).toEqual(created);
      // Absent registration fields become explicit NULL columns (`?? null`).
      expect(prisma.client.workspace.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT,
          name: 'Northwind',
          legalName: null,
          street: null,
          postalCode: null,
          city: 'Springfield',
        },
        select: WORKSPACE_SELECT,
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.WORKSPACE_CREATED,
          targetType: 'Workspace',
          targetId: 'f-9',
          workspaceId: 'f-9',
        }),
      );
    });

    it('maps the @@unique([tenantId, name]) violation to the generic ConflictError', async () => {
      const { service, prisma, audit } = buildSubject();
      prisma.client.workspace.create.mockRejectedValue(uniqueViolation(['tenantId', 'name']));

      await expect(inTenant(() => service.create({ name: 'Northwind' }))).rejects.toMatchObject({
        appCode: AppErrorCode.ALREADY_EXISTS,
      });
      await expect(inTenant(() => service.create({ name: 'Northwind' }))).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('fails closed without a tenant in the request context', async () => {
      const { service, prisma } = buildSubject();

      await expect(service.create({ name: 'Northwind' })).rejects.toThrow();
      expect(prisma.client.workspace.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('refuses a Workspace outside the tenant scope as not found', async () => {
      const { service, prisma } = buildSubject();
      prisma.client.workspace.findUnique.mockResolvedValue(null);

      await expect(
        inTenant(() => service.update({ workspaceId: 'f-foreign', name: 'X' })),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(prisma.client.workspace.update).not.toHaveBeenCalled();
    });

    it('writes the changed fields and audits their names only', async () => {
      const { service, prisma, audit } = buildSubject();
      const updated = workspaceRow({ city: 'Springfield', street: 'Main St 1' });
      prisma.client.workspace.findUnique.mockResolvedValue({ id: 'f-1' });
      prisma.client.workspace.update.mockResolvedValue(updated);

      const result = await inTenant(() =>
        service.update({ workspaceId: 'f-1', city: 'Springfield', street: 'Main St 1' }),
      );

      expect(result).toEqual(updated);
      expect(prisma.client.workspace.update).toHaveBeenCalledWith({
        where: { id: 'f-1' },
        data: { street: 'Main St 1', city: 'Springfield' },
        select: WORKSPACE_SELECT,
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUDIT_ACTIONS.WORKSPACE_UPDATED,
          targetType: 'Workspace',
          targetId: 'f-1',
          workspaceId: 'f-1',
          metadata: { fields: ['street', 'city'] },
        }),
      );
    });

    it('clears a field with null', async () => {
      const { service, prisma } = buildSubject();
      prisma.client.workspace.findUnique.mockResolvedValue({ id: 'f-1' });
      prisma.client.workspace.update.mockResolvedValue(workspaceRow());

      await inTenant(() => service.update({ workspaceId: 'f-1', city: null }));

      expect(prisma.client.workspace.update).toHaveBeenCalledWith({
        where: { id: 'f-1' },
        data: { city: null },
        select: WORKSPACE_SELECT,
      });
    });
  });
});
