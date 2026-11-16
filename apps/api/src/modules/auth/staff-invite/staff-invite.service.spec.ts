import { Test } from '@nestjs/testing';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { ROLES } from '@repo/shared/permissions';
import { STAFF_INVITE_TOKEN_TTL_MS } from '@repo/shared/constants';
import { AppErrorCode } from '@repo/shared/errors';
import { requestContext } from '../../../common/context/request-context';
import { AuditService } from '../../audit/audit.service';
import { MailService } from '../../mail/mail.service';
import { UserService } from '../../user/user.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { PasswordService } from '../services/password.service';
import { AuthSharedService } from '../services/auth-shared.service';
import { TotpService } from '../services/totp.service';
import { StepUpService } from '../services/step-up.service';
import { TokenRepository } from '../repositories/token.repository';
import { SecondFactorRepository } from '../repositories/second-factor.repository';
import { StaffInviteService } from './staff-invite.service';
import { StaffInviteRepository } from './staff-invite.repository';
import { STAFF_INVITE_FAILURE_REASONS } from './staff-invite.constants';

// A fixed clock: token-expiry assertions cannot be made against a moving now.
jest.mock('../../../common/clock', () => ({
  ...jest.requireActual('../../../common/clock'),
  now: () => new Date('2026-06-15T10:00:00.000Z'),
  nowMs: () => new Date('2026-06-15T10:00:00.000Z').getTime(),
}));

const FIXED_NOW = new Date('2026-06-15T10:00:00.000Z');
const TENANT = 'tenant-a';
const ACTOR = 'user-admin';

/**
 * Run `fn` inside an ALS store carrying the active organization.
 *
 * `invite` and `revoke` read the tenant from the ALS rather than from an
 * argument, matching UserService.updateRole, so calling them outside a scope is
 * a refusal rather than an oversight.
 */
const withTenant = <T>(fn: () => Promise<T>): Promise<T> =>
  requestContext.run({ requestId: 't', tenantId: TENANT }, fn);

/** A live token row as `findFirst` returns it. */
const liveToken = (overrides: Record<string, unknown> = {}) => ({
  id: 'tok-1',
  userId: 'user-invitee',
  expiresAt: new Date('2026-06-20T10:00:00.000Z'),
  staffInviteTenantId: null,
  staffInviteRole: null,
  ...overrides,
});

const buildSubject = async () => {
  const tx = {
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    workspace: { count: jest.fn().mockResolvedValue(0) },
    token: { create: jest.fn().mockResolvedValue({ id: 'tok-1' }) },
  };
  const repository = {
    findAccountByEmail: jest.fn().mockResolvedValue(null),
    createPendingMember: jest.fn().mockResolvedValue({ id: 'user-new' }),
    acceptInPlace: jest.fn().mockResolvedValue(1),
    acceptAndMove: jest.fn().mockResolvedValue(1),
    countAllUsersInTenant: jest.fn().mockResolvedValue(1),
    deleteTenant: jest.fn().mockResolvedValue(undefined),
    findTenantName: jest.fn().mockResolvedValue('Organization A'),
    findDisplayName: jest.fn().mockResolvedValue('Jane'),
    deletePendingMember: jest.fn().mockResolvedValue(1),
    findOwnerId: jest.fn().mockResolvedValue('user-owner'),
    deleteForeignInviteToken: jest.fn().mockResolvedValue(null),
  };
  const tokenRepository = {
    deleteById: jest.fn().mockResolvedValue(undefined),
    consumeById: jest.fn().mockResolvedValue(true),
    deleteUserTokensByType: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    client: {
      token: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (cb: (client: unknown) => Promise<unknown>) => cb(tx)),
    },
  };
  const password = { hash: jest.fn().mockResolvedValue('argon2-hash') };
  const user = {
    normalizeEmail: jest.fn((email: string) => email.trim().toLowerCase()),
    revokeAuthState: jest.fn().mockResolvedValue(undefined),
  };
  const mail = { sendStaffInviteEmail: jest.fn().mockResolvedValue(undefined) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const shared = {
    appUrl: 'https://app.example.com',
    enforceRateLimit: jest.fn().mockResolvedValue(undefined),
  };
  const secondFactor = {
    findActiveNonRecovery: jest.fn().mockResolvedValue(null),
    findActiveTotp: jest.fn().mockResolvedValue(null),
    redeemRecoveryCode: jest.fn().mockResolvedValue(false),
  };
  const totp = { verify: jest.fn().mockResolvedValue(false) };

  const module = await Test.createTestingModule({
    providers: [
      StaffInviteService,
      { provide: StaffInviteRepository, useValue: repository },
      { provide: TokenRepository, useValue: tokenRepository },
      { provide: PrismaService, useValue: prisma },
      { provide: PasswordService, useValue: password },
      { provide: UserService, useValue: user },
      { provide: MailService, useValue: mail },
      { provide: AuditService, useValue: audit },
      { provide: AuthSharedService, useValue: shared },
      { provide: SecondFactorRepository, useValue: secondFactor },
      { provide: TotpService, useValue: totp },
      // Real, not mocked: it runs the second-factor gate entirely through the
      // four mocks above, so the assertions on `secondFactor`, `totp.verify`,
      // `shared.enforceRateLimit` and the AUTH_2FA_CHALLENGE_FAILURE row still
      // exercise the same sequence they did when it was inlined here.
      StepUpService,
    ],
  }).compile();

  return {
    service: module.get(StaffInviteService),
    repository,
    tokenRepository,
    prisma,
    tx,
    password,
    user,
    mail,
    audit,
    shared,
    secondFactor,
    totp,
  };
};

const auditFor = (audit: { log: jest.Mock }, action: string) =>
  audit.log.mock.calls.map(([entry]) => entry).filter((entry) => entry.action === action);

describe('StaffInviteService.invite', () => {
  it('creates a pending member for an address nobody holds', async () => {
    const { service, repository, mail } = await buildSubject();

    const result = await withTenant(() =>
      service.invite('New@Example.com', ROLES.USER, ACTOR, 'ip', 'ua'),
    );

    expect(result).toEqual({ pending: true, emailSent: true });
    expect(repository.createPendingMember).toHaveBeenCalledWith(
      'new@example.com',
      TENANT,
      ROLES.USER,
    );
    expect(mail.sendStaffInviteEmail).toHaveBeenCalledWith(
      'new@example.com',
      expect.stringContaining('/auth/invite/'),
      'Organization A',
      expect.objectContaining({ movesExistingAccount: false }),
    );
  });

  it('mints the token with the shared TTL and no invite target on the ordinary path', async () => {
    const { service, tx } = await buildSubject();

    await withTenant(() => service.invite('new@example.com', ROLES.ADMIN, ACTOR, 'ip', 'ua'));

    const created = tx.token.create.mock.calls[0][0].data;
    expect(created.type).toBe('STAFF_INVITE');
    expect(created.staffInviteTenantId).toBeNull();
    // Null rather than ADMIN: the pending row carries the role on this path, and
    // a token that remembered one too would undo a later re-grade.
    expect(created.staffInviteRole).toBeNull();
    expect(created.expiresAt.getTime()).toBe(FIXED_NOW.getTime() + STAFF_INVITE_TOKEN_TTL_MS);
  });

  it('replaces any earlier invitation in the same transaction as the new one', async () => {
    // Outside one transaction two concurrent invitations can interleave so both
    // deletes run before either create, leaving two live single-use tokens.
    const { service, tokenRepository, prisma } = await buildSubject();

    await withTenant(() => service.invite('new@example.com', ROLES.USER, ACTOR, 'ip', 'ua'));

    expect(prisma.client.$transaction).toHaveBeenCalled();
    expect(tokenRepository.deleteUserTokensByType).toHaveBeenCalledWith(
      'user-new',
      'STAFF_INVITE',
      expect.anything(),
    );
  });

  it('refuses a soft-deleted address of this organization and says when it frees up', async () => {
    // The soft-deleted row holds the globally unique address until purge, so
    // "delete and get re-invited" is a remedy that fails for about a month. The
    // copy has to be honest about that rather than offering it.
    const { service, repository } = await buildSubject();
    repository.findAccountByEmail.mockResolvedValue({
      id: 'user-dead',
      role: ROLES.USER,
      tenantId: TENANT,
      deletedAt: new Date('2026-06-01T00:00:00Z'),
      passwordHash: 'x',
      membershipEndedAt: null,
    });

    await expect(
      withTenant(() => service.invite('gone@example.com', ROLES.USER, ACTOR, 'ip', 'ua')),
    ).rejects.toThrow(/purged/i);
  });

  it('answers a soft-deleted address in ANOTHER organization exactly like a fresh address', async () => {
    const { service, repository, audit, mail, tx } = await buildSubject();
    repository.findAccountByEmail.mockResolvedValue({
      id: 'user-dead',
      role: ROLES.USER,
      tenantId: 'tenant-b',
      deletedAt: new Date('2026-06-01T00:00:00Z'),
      passwordHash: 'x',
      membershipEndedAt: null,
    });

    const result = await withTenant(() =>
      service.invite('gone@example.com', ROLES.USER, ACTOR, 'ip', 'ua'),
    );

    expect(result).toEqual({ pending: true, emailSent: true });
    expect(tx.token.create).not.toHaveBeenCalled();
    expect(mail.sendStaffInviteEmail).not.toHaveBeenCalled();
    expect(auditFor(audit, AUDIT_ACTIONS.STAFF_INVITE_FAILED)[0]).toMatchObject({
      metadata: { reason: STAFF_INVITE_FAILURE_REASONS.DELETED_ADDRESS },
    });
  });

  it('refuses an active member of this organization', async () => {
    const { service, repository, audit } = await buildSubject();
    repository.findAccountByEmail.mockResolvedValue({
      id: 'user-colleague',
      role: ROLES.USER,
      tenantId: TENANT,
      deletedAt: null,
      passwordHash: 'argon2',
      membershipEndedAt: null,
    });

    await expect(
      withTenant(() => service.invite('col@example.com', ROLES.USER, ACTOR, 'ip', 'ua')),
    ).rejects.toMatchObject({ appCode: AppErrorCode.ALREADY_EXISTS });
    expect(auditFor(audit, AUDIT_ACTIONS.STAFF_INVITE_FAILED)[0]).toMatchObject({
      metadata: { reason: STAFF_INVITE_FAILURE_REASONS.ALREADY_A_MEMBER },
    });
  });

  it('refuses a Google-only colleague as a member, never re-inviting them as pending', async () => {
    // No password and a provider-verified address: a member. Reading the null
    // password alone would mail a set-password link for an account in use.
    const { service, repository, audit, tx, mail } = await buildSubject();
    repository.findAccountByEmail.mockResolvedValue({
      id: 'user-google',
      role: ROLES.ADMIN,
      tenantId: TENANT,
      deletedAt: null,
      passwordHash: null,
      emailVerified: true,
      membershipEndedAt: null,
    });

    await expect(
      withTenant(() => service.invite('g@example.com', ROLES.USER, ACTOR, 'ip', 'ua')),
    ).rejects.toMatchObject({ appCode: AppErrorCode.ALREADY_EXISTS });
    expect(tx.token.create).not.toHaveBeenCalled();
    expect(mail.sendStaffInviteEmail).not.toHaveBeenCalled();
    expect(auditFor(audit, AUDIT_ACTIONS.STAFF_INVITE_FAILED)[0]).toMatchObject({
      metadata: { reason: STAFF_INVITE_FAILURE_REASONS.ALREADY_A_MEMBER },
    });
  });

  it('points a removed member at restore rather than re-inviting them', async () => {
    // Re-inviting would mint a set-password link for an account that already has
    // a password, and would throw away the history restore keeps.
    const { service, repository, audit } = await buildSubject();
    repository.findAccountByEmail.mockResolvedValue({
      id: 'user-left',
      role: ROLES.USER,
      tenantId: TENANT,
      deletedAt: null,
      passwordHash: 'argon2',
      membershipEndedAt: new Date('2026-05-01T00:00:00Z'),
    });

    await expect(
      withTenant(() => service.invite('left@example.com', ROLES.USER, ACTOR, 'ip', 'ua')),
    ).rejects.toThrow(/[Rr]estore/);
    expect(auditFor(audit, AUDIT_ACTIONS.STAFF_INVITE_FAILED)[0]).toMatchObject({
      metadata: { reason: STAFF_INVITE_FAILURE_REASONS.REMOVED_MEMBER },
    });
  });

  it('resends to a pending member without re-applying the role from this call', async () => {
    // An admin may have re-graded the pending row through the ordinary role
    // surface since the first invitation; the row is the truth, not this call.
    const { service, repository, tx, audit } = await buildSubject();
    repository.findAccountByEmail.mockResolvedValue({
      id: 'user-pending',
      role: ROLES.ADMIN,
      tenantId: TENANT,
      deletedAt: null,
      passwordHash: null,
      emailVerified: false,
      membershipEndedAt: null,
    });

    const result = await withTenant(() =>
      service.invite('p@example.com', ROLES.USER, ACTOR, 'ip', 'ua'),
    );

    expect(result.pending).toBe(true);
    expect(repository.createPendingMember).not.toHaveBeenCalled();
    expect(tx.token.create.mock.calls[0][0].data.userId).toBe('user-pending');
    expect(auditFor(audit, AUDIT_ACTIONS.STAFF_INVITE_SENT)[0]).toMatchObject({
      metadata: expect.objectContaining({ role: ROLES.ADMIN, outcome: 'reinvited' }),
    });
  });

  it('mints against the existing account and carries the target on the collision path', async () => {
    const { service, repository, tx, mail } = await buildSubject();
    repository.findAccountByEmail.mockResolvedValue({
      id: 'user-elsewhere',
      role: ROLES.ADMIN,
      tenantId: 'tenant-b',
      deletedAt: null,
      passwordHash: 'argon2',
      membershipEndedAt: null,
    });

    await withTenant(() => service.invite('own@example.com', ROLES.USER, ACTOR, 'ip', 'ua'));

    expect(repository.createPendingMember).not.toHaveBeenCalled();
    const created = tx.token.create.mock.calls[0][0].data;
    expect(created.userId).toBe('user-elsewhere');
    // Both, because there is no pending row here to carry the invitation terms.
    expect(created.staffInviteTenantId).toBe(TENANT);
    expect(created.staffInviteRole).toBe(ROLES.USER);
    expect(mail.sendStaffInviteEmail).toHaveBeenCalledWith(
      'own@example.com',
      expect.any(String),
      'Organization A',
      expect.objectContaining({ movesExistingAccount: true }),
    );
  });

  it('answers a collision exactly as it answers a fresh address', async () => {
    // The response shape is the anti-enumeration control: this procedure must
    // not become a way to ask whether an address has an account.
    const fresh = await buildSubject();
    const freshResult = await withTenant(() =>
      fresh.service.invite('a@example.net', ROLES.USER, ACTOR, 'ip', 'ua'),
    );

    const collision = await buildSubject();
    collision.repository.findAccountByEmail.mockResolvedValue({
      id: 'user-elsewhere',
      role: ROLES.USER,
      tenantId: 'tenant-b',
      deletedAt: null,
      passwordHash: 'argon2',
      membershipEndedAt: null,
    });
    const collisionResult = await withTenant(() =>
      collision.service.invite('a@example.net', ROLES.USER, ACTOR, 'ip', 'ua'),
    );

    expect(collisionResult).toEqual(freshResult);
  });

  it('never inspects whether the other organization is empty at invite time', async () => {
    // That answer would be stale by acceptance, and asking for it here would put
    // another organization's contents on an enumeration surface.
    const { service, repository } = await buildSubject();
    repository.findAccountByEmail.mockResolvedValue({
      id: 'user-elsewhere',
      role: ROLES.USER,
      tenantId: 'tenant-b',
      deletedAt: null,
      passwordHash: 'argon2',
      membershipEndedAt: null,
    });

    await withTenant(() => service.invite('own@example.com', ROLES.USER, ACTOR, 'ip', 'ua'));

    expect(repository.countAllUsersInTenant).not.toHaveBeenCalled();
  });

  it('reports a failed enqueue instead of stranding the pending row behind an error', async () => {
    const { service, mail, audit } = await buildSubject();
    mail.sendStaffInviteEmail.mockRejectedValue(new Error('redis down'));

    const result = await withTenant(() =>
      service.invite('new@example.com', ROLES.USER, ACTOR, 'ip', 'ua'),
    );

    expect(result).toEqual({ pending: true, emailSent: false });
    expect(auditFor(audit, AUDIT_ACTIONS.STAFF_INVITE_SENT)[0]).toMatchObject({
      metadata: expect.objectContaining({ emailSent: false }),
    });
  });

  it('mails without an inviter name when the inviter reads as null (a soft-deleted row)', async () => {
    const { service, repository, mail } = await buildSubject();
    repository.findDisplayName.mockResolvedValue(null);

    const result = await withTenant(() =>
      service.invite('new@example.com', ROLES.USER, ACTOR, 'ip', 'ua'),
    );

    expect(result).toEqual({ pending: true, emailSent: true });
    expect(mail.sendStaffInviteEmail).toHaveBeenCalledWith(
      'new@example.com',
      expect.stringContaining('/auth/invite/'),
      'Organization A',
      expect.objectContaining({ inviterName: undefined }),
    );
  });

  it('fails closed with no active organization rather than inviting into none', async () => {
    // AdminMiddleware guarantees a session but not a tenant, and an account
    // created under no organization would be one nothing can reach.
    const { service, repository } = await buildSubject();

    await expect(
      service.invite('new@example.com', ROLES.USER, ACTOR, 'ip', 'ua'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(repository.createPendingMember).not.toHaveBeenCalled();
  });

  it('keeps the invitee address out of the audit row', async () => {
    const { service, audit } = await buildSubject();

    await withTenant(() => service.invite('secret@example.com', ROLES.USER, ACTOR, 'ip', 'ua'));

    const entry = auditFor(audit, AUDIT_ACTIONS.STAFF_INVITE_SENT)[0];
    expect(JSON.stringify(entry)).not.toContain('secret@example.com');
    expect(entry.targetId).toBe('user-new');
  });
});

describe('StaffInviteService.revoke', () => {
  it('hard-deletes a pending row and records that the invitation existed', async () => {
    const { service, repository, audit } = await buildSubject();

    await withTenant(() => service.revoke('user-pending', ACTOR, 'ip', 'ua'));

    expect(repository.deletePendingMember).toHaveBeenCalledWith('user-pending', TENANT);
    expect(auditFor(audit, AUDIT_ACTIONS.STAFF_INVITE_REVOKED)).toHaveLength(1);
  });

  it('answers a cross-tenant id, a missing one and an accepted one identically', async () => {
    const { service, repository } = await buildSubject();
    repository.deletePendingMember.mockResolvedValue(0);

    await expect(withTenant(() => service.revoke('user-x', ACTOR, 'ip', 'ua'))).rejects.toThrow(
      /No pending invitation/,
    );
  });

  /**
   * Defense in depth over the pending predicate. This is a hard delete with
   * every foreign key to User cascading, and the one time the predicate was
   * wrong it was the Google-signup owner it could reach.
   */
  it.each([
    ['the organization owner', 'user-owner'],
    ["the caller's own account", ACTOR],
  ])('refuses %s before attempting any delete', async (_label, target) => {
    const { service, repository, audit } = await buildSubject();

    await expect(withTenant(() => service.revoke(target, ACTOR, 'ip', 'ua'))).rejects.toMatchObject(
      { code: 'FORBIDDEN' },
    );
    expect(repository.deletePendingMember).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('still withdraws in an organization that has no owner to name', async () => {
    const { service, repository } = await buildSubject();
    repository.findOwnerId.mockResolvedValue(null);

    await withTenant(() => service.revoke('user-pending', ACTOR, 'ip', 'ua'));

    expect(repository.deletePendingMember).toHaveBeenCalledWith('user-pending', TENANT);
  });
});

describe('StaffInviteService.withdrawByEmail', () => {
  it('deletes the cross-organization token for the normalized address and audits the withdrawal', async () => {
    const { service, repository, audit } = await buildSubject();
    repository.deleteForeignInviteToken.mockResolvedValue('user-elsewhere');

    await withTenant(() => service.withdrawByEmail('  Own@Example.COM ', 'ip', 'ua'));

    expect(repository.deleteForeignInviteToken).toHaveBeenCalledWith(
      'own@example.com',
      TENANT,
      expect.any(Date),
    );
    // Never the account: withdrawing is the token, the person is somebody else's.
    expect(repository.deletePendingMember).not.toHaveBeenCalled();
    expect(auditFor(audit, AUDIT_ACTIONS.STAFF_INVITE_REVOKED)).toEqual([
      expect.objectContaining({
        targetType: 'User',
        targetId: 'user-elsewhere',
        metadata: { movesExistingAccount: true },
      }),
    ]);
  });

  it('answers the same when nothing was open, and writes no audit row', async () => {
    // "Nothing to withdraw" would split staff-elsewhere addresses (which leave a
    // token) from deleted ones (which do not), the classification
    // `invite` is built never to reveal.
    const { service, audit } = await buildSubject();

    await expect(
      withTenant(() => service.withdrawByEmail('nobody@example.com', 'ip', 'ua')),
    ).resolves.toBeUndefined();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('fails closed with no active organization', async () => {
    const { service, repository } = await buildSubject();

    await expect(service.withdrawByEmail('a@example.net', 'ip', 'ua')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(repository.deleteForeignInviteToken).not.toHaveBeenCalled();
  });
});

describe('StaffInviteService.getInviteState', () => {
  it('reports nothing at all for a token that does not resolve', async () => {
    const { service } = await buildSubject();

    await expect(service.getInviteState('nope', 'ip')).resolves.toEqual({
      valid: false,
      requiresTwoFactor: false,
      movesExistingAccount: false,
    });
  });

  it('does not burn an expired token, because a page load must not have side effects', async () => {
    const { service, prisma, tokenRepository } = await buildSubject();
    prisma.client.token.findFirst.mockResolvedValue(
      liveToken({ expiresAt: new Date('2026-06-01T00:00:00Z') }),
    );

    await expect(service.getInviteState('tok', 'ip')).resolves.toMatchObject({ valid: false });
    expect(tokenRepository.deleteById).not.toHaveBeenCalled();
  });

  it('tells the form it needs a code, and that accepting moves the account', async () => {
    const { service, prisma, secondFactor } = await buildSubject();
    prisma.client.token.findFirst.mockResolvedValue(
      liveToken({ staffInviteTenantId: TENANT, staffInviteRole: ROLES.USER }),
    );
    secondFactor.findActiveNonRecovery.mockResolvedValue({ id: 'sf-1' });

    await expect(service.getInviteState('tok', 'ip')).resolves.toEqual({
      valid: true,
      requiresTwoFactor: true,
      movesExistingAccount: true,
    });
  });
});

describe('StaffInviteService.accept', () => {
  const arrange = async (
    token: Record<string, unknown> = {},
    userRow: Record<string, unknown> = {},
  ) => {
    const subject = await buildSubject();
    subject.prisma.client.token.findFirst.mockResolvedValue(liveToken(token));
    subject.tx.user.findUnique.mockResolvedValue({
      id: 'user-invitee',
      tenantId: TENANT,
      role: ROLES.USER,
      membershipEndedAt: null,
      ...userRow,
    });
    return subject;
  };

  it('sets the password on a pending account already in the organization', async () => {
    const { service, repository, audit } = await arrange();

    await service.accept('tok', 'Str0ng-Pass!', undefined, 'ip', 'ua');

    expect(repository.acceptInPlace).toHaveBeenCalledWith(
      expect.anything(),
      'user-invitee',
      TENANT,
      'argon2-hash',
    );
    expect(repository.acceptAndMove).not.toHaveBeenCalled();
    expect(auditFor(audit, AUDIT_ACTIONS.STAFF_INVITE_ACCEPTED)).toHaveLength(1);
    expect(auditFor(audit, AUDIT_ACTIONS.USER_TENANT_MOVED)).toHaveLength(0);
  });

  it('runs the acceptance transaction at Serializable', async () => {
    // Not caution: at READ COMMITTED a workspace created concurrently is counted
    // before it commits and then silently cascaded away by the tenant delete.
    const { service, prisma } = await arrange();

    await service.accept('tok', 'Str0ng-Pass!', undefined, 'ip', 'ua');

    expect(prisma.client.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('hashes the password only after the token resolves', async () => {
    // This endpoint has no captcha, so validating first is what stops a garbage
    // token being replayed to burn Argon2 cycles.
    const { service, password, prisma } = await buildSubject();
    prisma.client.token.findFirst.mockResolvedValue(null);

    await expect(service.accept('nope', 'Str0ng-Pass!', undefined, 'ip', 'ua')).rejects.toThrow();
    expect(password.hash).not.toHaveBeenCalled();
  });

  it('burns an expired token outside the transaction and refuses generically', async () => {
    const { service, prisma, tokenRepository } = await buildSubject();
    prisma.client.token.findFirst.mockResolvedValue(
      liveToken({ expiresAt: new Date('2026-06-01T00:00:00Z') }),
    );

    await expect(
      service.accept('tok', 'Str0ng-Pass!', undefined, 'ip', 'ua'),
    ).rejects.toMatchObject({ appCode: AppErrorCode.INVALID_TOKEN });
    expect(tokenRepository.deleteById).toHaveBeenCalledWith('tok-1');
    expect(prisma.client.$transaction).not.toHaveBeenCalled();
  });

  it('refuses when a concurrent acceptance already consumed the token', async () => {
    const { service, tokenRepository } = await arrange();
    tokenRepository.consumeById.mockResolvedValue(false);

    await expect(
      service.accept('tok', 'Str0ng-Pass!', undefined, 'ip', 'ua'),
    ).rejects.toMatchObject({ appCode: AppErrorCode.INVALID_TOKEN });
  });

  it('refuses generically when the guarded update matches nothing', async () => {
    // Gone, not staff, or already has a password. Which one must not be readable
    // from an invitation link.
    const { service, repository } = await arrange();
    repository.acceptInPlace.mockResolvedValue(0);

    await expect(
      service.accept('tok', 'Str0ng-Pass!', undefined, 'ip', 'ua'),
    ).rejects.toMatchObject({ appCode: AppErrorCode.INVALID_TOKEN });
  });

  it('establishes no session, and revokes whatever the account had', async () => {
    const { service, user } = await arrange();

    await service.accept('tok', 'Str0ng-Pass!', undefined, 'ip', 'ua');

    expect(user.revokeAuthState).toHaveBeenCalledWith('user-invitee');
  });

  describe('the collision branch', () => {
    const collision = async (userRow: Record<string, unknown> = {}) =>
      arrange(
        { staffInviteTenantId: TENANT, staffInviteRole: ROLES.USER },
        { tenantId: 'tenant-b', role: ROLES.ADMIN, ...userRow },
      );

    it('moves the account, takes the invited role, and closes the abandoned organization', async () => {
      const { service, repository } = await collision();

      await service.accept('tok', 'Str0ng-Pass!', undefined, 'ip', 'ua');

      expect(repository.acceptAndMove).toHaveBeenCalledWith(
        expect.anything(),
        'user-invitee',
        TENANT,
        ROLES.USER,
        'argon2-hash',
      );
      expect(repository.deleteTenant).toHaveBeenCalledWith(expect.anything(), 'tenant-b');
    });

    it('moves before deleting, because User.tenantId is Restrict', async () => {
      const { service, repository } = await collision();

      await service.accept('tok', 'Str0ng-Pass!', undefined, 'ip', 'ua');

      expect(repository.acceptAndMove.mock.invocationCallOrder[0]!).toBeLessThan(
        repository.deleteTenant.mock.invocationCallOrder[0]!,
      );
    });

    it('takes the token role rather than the account role it arrives with', async () => {
      // The account is an ADMIN of its own organization and was invited as a USER.
      // Carrying the old role across would be a privilege grant nobody made.
      const { service, repository } = await collision();

      await service.accept('tok', 'Str0ng-Pass!', undefined, 'ip', 'ua');

      expect(repository.acceptAndMove.mock.calls[0][3]).toBe(ROLES.USER);
    });

    it('counts every user row, not the live ones', async () => {
      // A soft-deleted colleague still pending purge would abort the tenant
      // delete with a P2003 long after the caller was told this was fine.
      const { service, repository } = await collision();
      repository.countAllUsersInTenant.mockResolvedValue(2);

      await expect(service.accept('tok', 'Str0ng-Pass!', undefined, 'ip', 'ua')).rejects.toThrow(
        /still belongs to an organization/,
      );
      expect(repository.deleteTenant).not.toHaveBeenCalled();
    });

    it.each([['workspace', 'workspace']] as const)(
      'refuses when the old organization still holds a %s',
      async (_label, model) => {
        const { service, repository, tx } = await collision();
        tx[model].count.mockResolvedValue(1);

        await expect(service.accept('tok', 'Str0ng-Pass!', undefined, 'ip', 'ua')).rejects.toThrow(
          /still belongs to an organization/,
        );
        expect(repository.deleteTenant).not.toHaveBeenCalled();
      },
    );

    it('moves a REMOVED member without deleting the organization they left', async () => {
      // They left; that organization is populated, not abandoned. Folding the two cases
      // together would refuse them with a remedy they cannot perform on an organization
      // they do not own, leaving the account unusable and unerasable forever.
      const { service, repository } = await collision({
        membershipEndedAt: new Date('2026-05-01T00:00:00Z'),
      });
      repository.countAllUsersInTenant.mockResolvedValue(5);

      await service.accept('tok', 'Str0ng-Pass!', undefined, 'ip', 'ua');

      expect(repository.acceptAndMove).toHaveBeenCalled();
      expect(repository.deleteTenant).not.toHaveBeenCalled();
    });

    it('records both tenants AND both roles on the move', async () => {
      const { service, audit } = await collision();

      await service.accept('tok', 'Str0ng-Pass!', undefined, 'ip', 'ua');

      expect(auditFor(audit, AUDIT_ACTIONS.USER_TENANT_MOVED)[0]).toMatchObject({
        before: { tenantId: 'tenant-b', role: ROLES.ADMIN },
        after: { tenantId: TENANT, role: ROLES.USER },
      });
    });

    it('retries a serialization failure rather than surfacing it', async () => {
      const { service, prisma, repository } = await collision();
      let calls = 0;
      prisma.client.$transaction.mockImplementation(
        async (cb: (c: unknown) => Promise<unknown>) => {
          calls += 1;
          if (calls === 1) throw Object.assign(new Error('serialize'), { code: 'P2034' });
          return cb({
            user: {
              findUnique: jest.fn().mockResolvedValue({
                id: 'user-invitee',
                tenantId: 'tenant-b',
                role: ROLES.ADMIN,
                membershipEndedAt: null,
              }),
            },
            workspace: { count: jest.fn().mockResolvedValue(0) },
          });
        },
      );

      await service.accept('tok', 'Str0ng-Pass!', undefined, 'ip', 'ua');

      expect(calls).toBe(2);
      expect(repository.acceptAndMove).toHaveBeenCalled();
    });

    it('gives up rather than looping forever on a genuinely contended row', async () => {
      const { service, prisma } = await collision();
      prisma.client.$transaction.mockRejectedValue(
        Object.assign(new Error('serialize'), { code: 'P2034' }),
      );

      await expect(
        service.accept('tok', 'Str0ng-Pass!', undefined, 'ip', 'ua'),
      ).rejects.toMatchObject({ code: 'P2034' });
      expect(prisma.client.$transaction).toHaveBeenCalledTimes(4);
    });
  });

  describe('the second-factor gate', () => {
    it('refuses acceptance on a 2FA-protected account with no code', async () => {
      // resetPassword refuses to change a password on mailbox proof alone when a
      // factor is active. This path does strictly more on the same proof.
      const { service, secondFactor, repository } = await arrange(
        { staffInviteTenantId: TENANT, staffInviteRole: ROLES.USER },
        { tenantId: 'tenant-b' },
      );
      secondFactor.findActiveNonRecovery.mockResolvedValue({ id: 'sf-1' });

      await expect(
        service.accept('tok', 'Str0ng-Pass!', undefined, 'ip', 'ua'),
      ).rejects.toMatchObject({ appCode: AppErrorCode.TWO_FACTOR_INVALID_CODE });
      expect(repository.acceptAndMove).not.toHaveBeenCalled();
    });

    it('accepts a valid TOTP', async () => {
      const { service, secondFactor, totp, repository } = await arrange();
      secondFactor.findActiveNonRecovery.mockResolvedValue({ id: 'sf-1' });
      secondFactor.findActiveTotp.mockResolvedValue({ totpSecretEnc: 'enc' });
      totp.verify.mockResolvedValue(true);

      await service.accept('tok', 'Str0ng-Pass!', '123456', 'ip', 'ua');

      expect(repository.acceptInPlace).toHaveBeenCalled();
    });

    it('audits a bad code under the challenge flow reason', async () => {
      const { service, secondFactor, audit } = await arrange();
      secondFactor.findActiveNonRecovery.mockResolvedValue({ id: 'sf-1' });

      await expect(
        service.accept('tok', 'Str0ng-Pass!', '000000', 'ip', 'ua'),
      ).rejects.toMatchObject({ appCode: AppErrorCode.TWO_FACTOR_INVALID_CODE });
      expect(auditFor(audit, AUDIT_ACTIONS.AUTH_2FA_CHALLENGE_FAILURE)[0]).toMatchObject({
        metadata: { reason: 'bad_code', context: 'staff_invite_accept' },
      });
    });

    it('checks for a factor on the ordinary path too, not only on a move', async () => {
      // A pending account cannot hold one today, so this costs an indexed read
      // and can never refuse. Making it conditional would become a hole the day
      // pending accounts can enroll.
      const { service, secondFactor } = await arrange();

      await service.accept('tok', 'Str0ng-Pass!', undefined, 'ip', 'ua');

      expect(secondFactor.findActiveNonRecovery).toHaveBeenCalledWith('user-invitee');
    });
  });
});
