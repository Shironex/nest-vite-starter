import { TrustedDeviceService } from './trusted-device.service';
import { createAuthTestModule } from '@test/test-module';
import { expressMocks } from '@test/fixtures';
import { TRUSTED_DEVICE_CAP } from '../auth.constants';

const TRUST_COOKIE = '2fa-trust'; // dev name (NODE_ENV=test)

const blob = (userId: string, createdAt = 1_700_000_000_000) =>
  JSON.stringify({ userId, createdAt, ip: '1.1.1.1', userAgent: 'ua' });

describe('TrustedDeviceService', () => {
  const build = async () => {
    const ctx = await createAuthTestModule({ providers: [TrustedDeviceService] });
    return { ...ctx, service: ctx.get(TrustedDeviceService) };
  };

  const reqWithCookie = (token?: string) => {
    const { req, res } = expressMocks();
    (req as unknown as { cookies: Record<string, string> }).cookies = token
      ? { [TRUST_COOKIE]: token }
      : {};
    return { req, res };
  };

  describe('isTrusted', () => {
    it('false when there is no cookie', async () => {
      const { service } = await build();
      const { req } = reqWithCookie();
      expect(await service.isTrusted(req, 'u-1')).toBe(false);
    });

    it('true when the stored blob belongs to the same user', async () => {
      const { service, mocks } = await build();
      const { req } = reqWithCookie('token');
      mocks.redis.get.mockResolvedValue(blob('u-1'));
      expect(await service.isTrusted(req, 'u-1')).toBe(true);
    });

    it('false when the blob belongs to a DIFFERENT user (load-bearing match)', async () => {
      const { service, mocks } = await build();
      const { req } = reqWithCookie('token');
      mocks.redis.get.mockResolvedValue(blob('someone-else'));
      expect(await service.isTrusted(req, 'u-1')).toBe(false);
    });

    it('false when the record is missing or corrupt', async () => {
      const { service, mocks } = await build();
      const { req } = reqWithCookie('token');
      mocks.redis.get.mockResolvedValueOnce(null);
      expect(await service.isTrusted(req, 'u-1')).toBe(false);
      mocks.redis.get.mockResolvedValueOnce('{corrupt');
      expect(await service.isTrusted(req, 'u-1')).toBe(false);
    });
  });

  describe('trust', () => {
    it('mints a record + cookie and enforces the cap', async () => {
      const { service, mocks } = await build();
      const { req, res } = reqWithCookie();
      mocks.redis.smembers.mockResolvedValue(['a']); // within cap -> no eviction

      await service.trust(req, res, 'u-1', '1.1.1.1', 'ua');

      expect(mocks.redis.multi).toHaveBeenCalled();
      expect(mocks.shared.setAuthCookie).toHaveBeenCalledWith(
        res,
        TRUST_COOKIE,
        expect.any(String),
        expect.any(Number),
      );
    });

    it('evicts the oldest devices beyond the cap', async () => {
      const { service, mocks } = await build();
      const { req, res } = reqWithCookie();
      const ids = Array.from({ length: TRUSTED_DEVICE_CAP + 2 }, (_, i) => `d${i}`);
      mocks.redis.smembers.mockResolvedValue(ids);
      // Oldest-first createdAt so d0, d1 are the two evicted.
      mocks.redis.mget.mockResolvedValue(ids.map((_, i) => blob('u-1', 1_000 + i)));
      const evictChain = {
        del: jest.fn().mockReturnThis(),
        srem: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      };
      // First multi() is the mint; second multi() is the eviction.
      mocks.redis.multi
        .mockReturnValueOnce({
          sadd: jest.fn().mockReturnThis(),
          expire: jest.fn().mockReturnThis(),
          setex: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        })
        .mockReturnValueOnce(evictChain);

      await service.trust(req, res, 'u-1', '1.1.1.1', 'ua');

      expect(evictChain.del).toHaveBeenCalledTimes(2);
      expect(evictChain.srem).toHaveBeenCalledTimes(2);
    });
  });

  describe('revokeAll', () => {
    it('deletes every device blob and the index set', async () => {
      const { service, mocks } = await build();
      mocks.redis.smembers.mockResolvedValue(['d1', 'd2']);
      const chain = { del: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([]) };
      mocks.redis.multi.mockReturnValue(chain);

      await service.revokeAll('u-1');

      // Two device blobs + the set itself.
      expect(chain.del).toHaveBeenCalledTimes(3);
    });
  });

  describe('count', () => {
    it('returns the set cardinality', async () => {
      const { service, mocks } = await build();
      mocks.redis.scard.mockResolvedValue(3);
      expect(await service.count('u-1')).toBe(3);
    });
  });
});
