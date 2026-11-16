import { Test } from '@nestjs/testing';
import { PrismaService } from '../../common/database/prisma.service';
import { requestContext } from '../../common/context/request-context';
import { buildPrismaMock, type PrismaServiceMock } from '@test/test-module';

// Mock the app logger factory to suppress output during tests
jest.mock('../logger/logger.service', () => ({
  createAppLogger: () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(),
  }),
}));

const captureExceptionMock = jest.fn();
jest.mock('@sentry/nestjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

import { AuditService } from './audit.service';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: PrismaServiceMock;

  beforeEach(async () => {
    captureExceptionMock.mockReset();
    prisma = buildPrismaMock();
    const module = await Test.createTestingModule({
      providers: [AuditService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(AuditService);
  });

  it('happy path: writes a row with all explicit params', async () => {
    prisma.client.auditLog.create.mockResolvedValue({});
    await service.log({
      action: 'auth.login.success',
      userId: 'u-1',
      targetType: 'User',
      targetId: 'u-1',
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
      metadata: { rememberMe: false },
    });

    expect(prisma.client.auditLog.create).toHaveBeenCalledTimes(1);
    const data = prisma.client.auditLog.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      action: 'auth.login.success',
      userId: 'u-1',
      targetType: 'User',
      targetId: 'u-1',
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
      metadata: { rememberMe: false },
      success: true,
    });
  });

  it('falls back to ALS context for userId / ipAddress / userAgent / correlationId', async () => {
    prisma.client.auditLog.create.mockResolvedValue({});
    await requestContext.run(
      {
        requestId: 'req-123',
        userId: 'als-user',
        ip: 'als-ip',
        userAgent: 'als-ua',
      },
      async () => {
        await service.log({ action: 'foo.bar' });
      },
    );

    const data = prisma.client.auditLog.create.mock.calls[0][0].data;
    expect(data.userId).toBe('als-user');
    expect(data.ipAddress).toBe('als-ip');
    expect(data.userAgent).toBe('als-ua');
    expect(data.correlationId).toBe('req-123');
  });

  it('writes correlationId: null when getRequestId returns "no-context"', async () => {
    prisma.client.auditLog.create.mockResolvedValue({});
    await service.log({ action: 'system.event' });
    const data = prisma.client.auditLog.create.mock.calls[0][0].data;
    expect(data.correlationId).toBeNull();
    expect(data.userId).toBeNull();
  });

  it('respects success: false (no coercion to true)', async () => {
    prisma.client.auditLog.create.mockResolvedValue({});
    await service.log({ action: 'auth.login.failure', success: false });
    expect(prisma.client.auditLog.create.mock.calls[0][0].data.success).toBe(false);
  });

  it('defaults success to true when omitted', async () => {
    prisma.client.auditLog.create.mockResolvedValue({});
    await service.log({ action: 'something' });
    expect(prisma.client.auditLog.create.mock.calls[0][0].data.success).toBe(true);
  });

  it('only includes before/after/metadata when defined (omits undefined)', async () => {
    prisma.client.auditLog.create.mockResolvedValue({});
    await service.log({ action: 'a' });
    const data = prisma.client.auditLog.create.mock.calls[0][0].data;
    expect('before' in data).toBe(false);
    expect('after' in data).toBe(false);
    expect('metadata' in data).toBe(false);
  });

  it('writes targetType when provided but targetId omitted (targetId becomes null)', async () => {
    prisma.client.auditLog.create.mockResolvedValue({});
    await service.log({ action: 'a', targetType: 'User' });
    const data = prisma.client.auditLog.create.mock.calls[0][0].data;
    expect(data.targetType).toBe('User');
    expect(data.targetId).toBeNull();
  });

  it('NEVER throws when Prisma rejects (critical audit contract)', async () => {
    prisma.client.auditLog.create.mockRejectedValue(new Error('DB down'));
    // No try/catch around this: if log() rethrows, the spec fails.
    await expect(service.log({ action: 'a' })).resolves.toBeUndefined();
  });

  it('NEVER throws when Prisma rejects with FK violation (P2003-style)', async () => {
    const err = Object.assign(new Error('FK violation'), { code: 'P2003' });
    prisma.client.auditLog.create.mockRejectedValue(err);
    await expect(service.log({ action: 'a', userId: 'ghost' })).resolves.toBeUndefined();
  });

  it('makes a swallowed write failure observable: Sentry capture', async () => {
    const err = new Error('DB down');
    prisma.client.auditLog.create.mockRejectedValue(err);

    await service.log({ action: 'thing.updated' });

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock).toHaveBeenCalledWith(err, {
      extra: expect.objectContaining({ action: 'thing.updated' }),
    });
  });

  it('does not touch Sentry on a successful write', async () => {
    prisma.client.auditLog.create.mockResolvedValue({});
    await service.log({ action: 'a' });
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('includes before/after/reason/metadata when explicitly provided', async () => {
    prisma.client.auditLog.create.mockResolvedValue({});
    await service.log({
      action: 'thing.updated',
      before: { name: 'old' },
      after: { name: 'new' },
      reason: 'admin override',
      metadata: { ticket: 'OPS-1' },
    });
    const data = prisma.client.auditLog.create.mock.calls[0][0].data;
    expect(data.before).toEqual({ name: 'old' });
    expect(data.after).toEqual({ name: 'new' });
    expect(data.reason).toBe('admin override');
    expect(data.metadata).toEqual({ ticket: 'OPS-1' });
  });

  it('falls back to explicit ipAddress / userAgent when ALS context exposes neither', async () => {
    prisma.client.auditLog.create.mockResolvedValue({});
    // ALS run with requestId only: no ip / userAgent / userId.
    await requestContext.run({ requestId: 'req-x' }, async () => {
      await service.log({
        action: 'a',
        ipAddress: 'explicit-ip',
        userAgent: 'explicit-ua',
      });
    });
    const data = prisma.client.auditLog.create.mock.calls[0][0].data;
    expect(data.ipAddress).toBe('explicit-ip');
    expect(data.userAgent).toBe('explicit-ua');
    expect(data.userId).toBeNull();
    expect(data.correlationId).toBe('req-x');
  });

  it('explicit userId takes precedence over ALS context userId', async () => {
    prisma.client.auditLog.create.mockResolvedValue({});
    await requestContext.run({ requestId: 'r', userId: 'als-user' }, async () => {
      await service.log({ action: 'a', userId: 'explicit-user' });
    });
    expect(prisma.client.auditLog.create.mock.calls[0][0].data.userId).toBe('explicit-user');
  });
});
