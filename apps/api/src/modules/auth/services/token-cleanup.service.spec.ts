import { TokenCleanupService } from './token-cleanup.service';
import type { TokenRepository } from '../repositories/token.repository';

describe('TokenCleanupService.sweep', () => {
  let tokenRepository: jest.Mocked<Pick<TokenRepository, 'deleteExpired'>>;
  let service: TokenCleanupService;

  beforeEach(() => {
    tokenRepository = { deleteExpired: jest.fn() };
    service = new TokenCleanupService(tokenRepository as unknown as TokenRepository);
  });

  it('deletes expired tokens and returns the deleted count', async () => {
    tokenRepository.deleteExpired.mockResolvedValue(3);
    const deleted = await service.sweep();
    expect(tokenRepository.deleteExpired).toHaveBeenCalledWith(expect.any(Date));
    expect(deleted).toBe(3);
  });

  it('returns 0 when nothing was deleted', async () => {
    tokenRepository.deleteExpired.mockResolvedValue(0);
    const deleted = await service.sweep();
    expect(deleted).toBe(0);
  });

  it('never throws (best-effort): a repo failure returns 0', async () => {
    tokenRepository.deleteExpired.mockRejectedValue(new Error('db down'));
    await expect(service.sweep()).resolves.toBe(0);
  });
});
