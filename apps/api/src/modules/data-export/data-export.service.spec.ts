import { Test } from '@nestjs/testing';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { RateLimitError } from '../../common/errors';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { DataExportService } from './data-export.service';
import { UserService } from '../user/user.service';
import { AuditService } from '../audit/audit.service';

const profileFixture = (id: string) => ({
  id,
  email: 'user@example.com',
  displayName: null,
  role: 'USER',
  emailVerified: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
});

const buildSubject = async (limiterCount = 1) => {
  const userService = { getProfile: jest.fn() };
  const auditService = { log: jest.fn().mockResolvedValue(undefined) };
  // Mirrors the auth-shared spec's limiter mock: multi().incr().expire().exec()
  // resolving [[null, count], ...]: count above the limit trips the limiter.
  const chain: { incr: jest.Mock; expire: jest.Mock; exec: jest.Mock } = {
    incr: jest.fn(() => chain),
    expire: jest.fn(() => chain),
    exec: jest.fn().mockResolvedValue([
      [null, limiterCount],
      [null, 1],
    ]),
  };
  const redis = { multi: jest.fn(() => chain) };
  const module = await Test.createTestingModule({
    providers: [
      DataExportService,
      { provide: UserService, useValue: userService },
      { provide: AuditService, useValue: auditService },
      { provide: REDIS_CLIENT, useValue: redis },
    ],
  }).compile();
  return { service: module.get(DataExportService), userService, auditService, redis };
};

describe('DataExportService', () => {
  it('exports the caller account profile under the versioned envelope', async () => {
    const { service, userService } = await buildSubject();
    userService.getProfile.mockResolvedValue(profileFixture('u-1'));

    const result = await service.exportForUser('u-1');

    expect(userService.getProfile).toHaveBeenCalledWith('u-1');
    expect(result.exportSchema).toBe(1);
    expect(result.exportedAt).toBeInstanceOf(Date);
    expect(result.account.id).toBe('u-1');
  });

  it('only ever reads the user id it is given (owner-scoped, no other lookups)', async () => {
    const { service, userService } = await buildSubject();
    userService.getProfile.mockResolvedValue(profileFixture('u-2'));

    await service.exportForUser('u-2');

    expect(userService.getProfile).toHaveBeenCalledTimes(1);
    expect(userService.getProfile).toHaveBeenCalledWith('u-2');
  });

  it('audits the access event with metadata only, never the export payload', async () => {
    const { service, auditService, userService } = await buildSubject();
    userService.getProfile.mockResolvedValue(profileFixture('u-3'));

    await service.exportForUser('u-3');

    expect(auditService.log).toHaveBeenCalledTimes(1);
    const entry = auditService.log.mock.calls[0][0];
    expect(entry).toEqual({
      action: AUDIT_ACTIONS.DATA_EXPORT_DOWNLOADED,
      userId: 'u-3',
      targetType: 'User',
      targetId: 'u-3',
    });
    // The export payload must never ride along in the audit row.
    expect(entry).not.toHaveProperty('before');
    expect(entry).not.toHaveProperty('after');
    expect(entry).not.toHaveProperty('metadata');
  });

  it('does not audit when the profile read throws (no phantom access rows)', async () => {
    const { service, auditService, userService } = await buildSubject();
    userService.getProfile.mockRejectedValue(new Error('not found'));

    await expect(service.exportForUser('ghost')).rejects.toThrow('not found');
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('rejects over-limit calls before doing any work (no read, no audit row)', async () => {
    const { service, auditService, userService } = await buildSubject(6);

    await expect(service.exportForUser('u-1')).rejects.toBeInstanceOf(RateLimitError);
    expect(userService.getProfile).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });
});
