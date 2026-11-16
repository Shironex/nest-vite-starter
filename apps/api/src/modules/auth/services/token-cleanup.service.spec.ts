import { TokenCleanupService } from './token-cleanup.service';
import type { TokenRepository } from '../repositories/token.repository';
import {
  cronSweepLastSuccessTimestampSeconds,
  tokenCleanupDeletedTotal,
} from '../../metrics/metrics.registry';

describe('TokenCleanupService.sweep', () => {
  let tokenRepository: jest.Mocked<Pick<TokenRepository, 'deleteExpired'>>;
  let service: TokenCleanupService;
  let incSpy: jest.SpyInstance;
  let livenessSpy: jest.SpyInstance;

  beforeEach(() => {
    tokenRepository = { deleteExpired: jest.fn() };
    service = new TokenCleanupService(tokenRepository as unknown as TokenRepository);
    incSpy = jest.spyOn(tokenCleanupDeletedTotal, 'inc').mockImplementation(() => undefined);
    livenessSpy = jest
      .spyOn(cronSweepLastSuccessTimestampSeconds, 'set')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    incSpy.mockRestore();
    livenessSpy.mockRestore();
  });

  it('deletes expired tokens and increments the counter by the deleted count', async () => {
    tokenRepository.deleteExpired.mockResolvedValue(3);
    const deleted = await service.sweep();
    expect(tokenRepository.deleteExpired).toHaveBeenCalledWith(expect.any(Date));
    expect(incSpy).toHaveBeenCalledWith(3);
    expect(deleted).toBe(3);
  });

  it('does not increment the counter when nothing was deleted', async () => {
    tokenRepository.deleteExpired.mockResolvedValue(0);
    const deleted = await service.sweep();
    expect(incSpy).not.toHaveBeenCalled();
    expect(deleted).toBe(0);
  });

  it('never throws (best-effort): a repo failure returns 0', async () => {
    tokenRepository.deleteExpired.mockRejectedValue(new Error('db down'));
    await expect(service.sweep()).resolves.toBe(0);
    expect(incSpy).not.toHaveBeenCalled();
  });

  it('marks liveness on a tick that deleted nothing', async () => {
    // The whole point: a quiet day and a scheduler that stopped firing produce
    // the same flat `token_cleanup_deleted_total`, so only this gauge can tell
    // them apart.
    tokenRepository.deleteExpired.mockResolvedValue(0);

    await service.sweep();

    expect(livenessSpy).toHaveBeenCalledWith({ sweep: 'token-cleanup' }, expect.any(Number));
  });

  it('does not mark liveness on a failed tick', async () => {
    tokenRepository.deleteExpired.mockRejectedValue(new Error('db down'));

    await service.sweep();

    expect(livenessSpy).not.toHaveBeenCalled();
  });
});
