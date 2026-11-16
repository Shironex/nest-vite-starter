import { Test } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import { TokenService, TokenType } from './token.service';
import { TokenRepository } from '../repositories/token.repository';
import { PrismaService } from '../../../common/database/prisma.service';
import { buildPrismaMock, type PrismaServiceMock } from '@test/test-module';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

type MockTokenRepository = {
  create: jest.Mock;
  findByHashedToken: jest.Mock;
  deleteById: jest.Mock;
  consumeById: jest.Mock;
  deleteUserTokensByType: jest.Mock;
};

describe('TokenService', () => {
  let service: TokenService;
  let tokenRepo: MockTokenRepository;
  let prisma: PrismaServiceMock;

  beforeEach(async () => {
    tokenRepo = {
      create: jest.fn(),
      findByHashedToken: jest.fn(),
      deleteById: jest.fn(),
      consumeById: jest.fn(),
      deleteUserTokensByType: jest.fn(),
    };
    prisma = buildPrismaMock();

    const module = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: TokenRepository, useValue: tokenRepo },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(TokenService);
  });

  describe('createVerificationToken', () => {
    it('should delete existing tokens and create a new one with 24h TTL, both on ONE tx client', async () => {
      tokenRepo.deleteUserTokensByType.mockResolvedValue(undefined);
      tokenRepo.create.mockResolvedValue({});

      const rawToken = await service.createVerificationToken('user-1');

      expect(rawToken).toHaveLength(64);
      expect(rawToken).toMatch(/^[0-9a-f]{64}$/);

      // Delete + create share the SAME tx client (the default prisma mock
      // passes `client` as the tx): two concurrent requests can otherwise
      // interleave and leave two live single-use tokens.
      expect(prisma.client.$transaction).toHaveBeenCalledTimes(1);
      expect(tokenRepo.deleteUserTokensByType).toHaveBeenCalledWith(
        'user-1',
        'EMAIL_VERIFICATION',
        prisma.client,
      );

      const [createCall, createTx] = tokenRepo.create.mock.calls[0];
      expect(createTx).toBe(prisma.client);
      expect(createCall.userId).toBe('user-1');
      expect(createCall.type).toBe('EMAIL_VERIFICATION');
      expect(createCall.token).toBe(hashToken(rawToken));
      expect(createCall.token).not.toBe(rawToken);

      const expiresAt = createCall.expiresAt as Date;
      const twentyFourHoursMs = 24 * 60 * 60 * 1000;
      const ttl = expiresAt.getTime() - Date.now();
      expect(ttl).toBeGreaterThan(twentyFourHoursMs - 1000);
      expect(ttl).toBeLessThanOrEqual(twentyFourHoursMs);
    });

    it('should use a supplied tx client (no nested transaction) so callers can join their own tx', async () => {
      tokenRepo.deleteUserTokensByType.mockResolvedValue(undefined);
      tokenRepo.create.mockResolvedValue({});
      const callerTx = {} as never;

      const rawToken = await service.createVerificationToken('user-1', callerTx);

      expect(rawToken).toMatch(/^[0-9a-f]{64}$/);
      // The caller's transaction is used directly; no second one is opened.
      expect(prisma.client.$transaction).not.toHaveBeenCalled();
      expect(tokenRepo.deleteUserTokensByType).toHaveBeenCalledWith(
        'user-1',
        'EMAIL_VERIFICATION',
        callerTx,
      );
      const [createCall, createTx] = tokenRepo.create.mock.calls[0];
      expect(createTx).toBe(callerTx);
      expect(createCall.token).toBe(hashToken(rawToken));
    });
  });

  describe('createPasswordResetToken', () => {
    it('should create a password reset token with 1-hour TTL, delete + create on ONE tx client', async () => {
      tokenRepo.deleteUserTokensByType.mockResolvedValue(undefined);
      tokenRepo.create.mockResolvedValue({});

      const rawToken = await service.createPasswordResetToken('user-1');

      expect(rawToken).toHaveLength(64);

      expect(prisma.client.$transaction).toHaveBeenCalledTimes(1);
      expect(tokenRepo.deleteUserTokensByType).toHaveBeenCalledWith(
        'user-1',
        'PASSWORD_RESET',
        prisma.client,
      );

      const [createCall, createTx] = tokenRepo.create.mock.calls[0];
      expect(createTx).toBe(prisma.client);
      expect(createCall.type).toBe('PASSWORD_RESET');
      const expiresAt = createCall.expiresAt as Date;
      const oneHourMs = 60 * 60 * 1000;
      const ttl = expiresAt.getTime() - Date.now();
      expect(ttl).toBeGreaterThan(oneHourMs - 1000);
      expect(ttl).toBeLessThanOrEqual(oneHourMs);
    });
  });

  describe('validateToken', () => {
    it('should return userId for a valid, non-expired token', async () => {
      const rawToken = 'a'.repeat(64);
      const hashed = hashToken(rawToken);
      const futureDate = new Date(Date.now() + 60_000);

      tokenRepo.findByHashedToken.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        token: hashed,
        type: 'EMAIL_VERIFICATION',
        expiresAt: futureDate,
      });
      tokenRepo.consumeById.mockResolvedValue(true);

      const result = await service.validateToken(rawToken, TokenType.EMAIL_VERIFICATION);

      expect(result).toEqual({ userId: 'user-1' });
      expect(tokenRepo.findByHashedToken).toHaveBeenCalledWith(hashed, 'EMAIL_VERIFICATION');
      expect(tokenRepo.consumeById).toHaveBeenCalledWith('token-1', undefined);
    });

    it('should forward the transaction client to the consume when one is supplied', async () => {
      const rawToken = 'd'.repeat(64);
      const futureDate = new Date(Date.now() + 60_000);
      const tx = { token: { deleteMany: jest.fn() } };

      tokenRepo.findByHashedToken.mockResolvedValue({
        id: 'token-4',
        userId: 'user-1',
        token: hashToken(rawToken),
        type: 'EMAIL_VERIFICATION',
        expiresAt: futureDate,
      });
      tokenRepo.consumeById.mockResolvedValue(true);

      const result = await service.validateToken(
        rawToken,
        TokenType.EMAIL_VERIFICATION,
        tx as never,
      );

      expect(result).toEqual({ userId: 'user-1' });
      // The single-use consume must ride the caller's transaction so it can
      // roll back together with the side effect it gates.
      expect(tokenRepo.consumeById).toHaveBeenCalledWith('token-4', tx);
    });

    it('should return null for a token not found in the database', async () => {
      tokenRepo.findByHashedToken.mockResolvedValue(null);

      const result = await service.validateToken('nonexistent', TokenType.EMAIL_VERIFICATION);

      expect(result).toBeNull();
      expect(tokenRepo.consumeById).not.toHaveBeenCalled();
    });

    it('should return null when a concurrent request already consumed the token', async () => {
      const rawToken = 'c'.repeat(64);
      const hashed = hashToken(rawToken);
      const futureDate = new Date(Date.now() + 60_000);

      tokenRepo.findByHashedToken.mockResolvedValue({
        id: 'token-3',
        userId: 'user-1',
        token: hashed,
        type: 'EMAIL_VERIFICATION',
        expiresAt: futureDate,
      });
      // consumeById loses the race → 0 rows deleted
      tokenRepo.consumeById.mockResolvedValue(false);

      const result = await service.validateToken(rawToken, TokenType.EMAIL_VERIFICATION);

      expect(result).toBeNull();
    });

    it('should return null and delete an expired token', async () => {
      const rawToken = 'b'.repeat(64);
      const hashed = hashToken(rawToken);
      const pastDate = new Date(Date.now() - 60_000);

      tokenRepo.findByHashedToken.mockResolvedValue({
        id: 'token-2',
        userId: 'user-1',
        token: hashed,
        type: 'EMAIL_VERIFICATION',
        expiresAt: pastDate,
      });
      tokenRepo.consumeById.mockResolvedValue(true);

      const result = await service.validateToken(rawToken, TokenType.EMAIL_VERIFICATION);

      expect(result).toBeNull();
      expect(tokenRepo.consumeById).toHaveBeenCalledWith('token-2', undefined);
    });

    it('should return null when token of correct hash but wrong type is requested (lookup misses)', async () => {
      // findByHashedToken filters by type, so wrong-type lookup returns null
      tokenRepo.findByHashedToken.mockResolvedValue(null);

      const result = await service.validateToken('whatever', TokenType.PASSWORD_RESET);

      expect(result).toBeNull();
      expect(tokenRepo.findByHashedToken).toHaveBeenCalledWith(
        expect.any(String),
        'PASSWORD_RESET',
      );
    });

    it('should hash empty-string tokens and return null on miss', async () => {
      tokenRepo.findByHashedToken.mockResolvedValue(null);
      const result = await service.validateToken('', TokenType.EMAIL_VERIFICATION);
      expect(result).toBeNull();
    });
  });
});
