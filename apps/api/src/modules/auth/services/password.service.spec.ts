import { Test } from '@nestjs/testing';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  let service: PasswordService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [PasswordService],
    }).compile();

    service = module.get(PasswordService);
  });

  describe('hash', () => {
    it('should return a non-empty string', async () => {
      const result = await service.hash('test-password');

      // An encoded Argon2id hash (PHC string format), not just any string.
      expect(result).toMatch(/^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$/);
    });

    it('should return a hash different from the input password', async () => {
      const password = 'my-secret-password';
      const hash = await service.hash(password);

      expect(hash).not.toBe(password);
    });

    it('should produce different hashes for the same password (unique salts)', async () => {
      const password = 'same-password';
      const hash1 = await service.hash(password);
      const hash2 = await service.hash(password);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verify', () => {
    it('should return true for a correct password', async () => {
      const password = 'correct-password';
      const hash = await service.hash(password);

      const result = await service.verify(hash, password);

      expect(result).toBe(true);
    });

    it('should return false for an incorrect password', async () => {
      const password = 'correct-password';
      const hash = await service.hash(password);

      const result = await service.verify(hash, 'wrong-password');

      expect(result).toBe(false);
    });

    it('should return false for an invalid hash format', async () => {
      const result = await service.verify('not-a-valid-hash', 'any-password');

      expect(result).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('hashes an empty password without throwing and verifies it', async () => {
      const h = await service.hash('');
      expect(h).toBeTruthy();
      expect(await service.verify(h, '')).toBe(true);
    });

    it('returns false when comparing empty input against a real hash', async () => {
      const h = await service.hash('real-password');
      expect(await service.verify(h, '')).toBe(false);
    });

    it('hashes a 1024-char password and verifies it (DoS bound check)', async () => {
      const long = 'a'.repeat(1024);
      const h = await service.hash(long);
      expect(await service.verify(h, long)).toBe(true);
    });

    it('round-trips a unicode password (CJK + ASCII + symbol)', async () => {
      const password = 'パスワード123!';
      const h = await service.hash(password);
      expect(await service.verify(h, password)).toBe(true);
    });

    /**
     * Argon2 hashes raw UTF-8 bytes, so without normalization the precomposed
     * "café" (U+00E9) and the decomposed "café" (e + U+0301) would hash to
     * different values: a latent UX bug (iOS keyboard often emits NFD;
     * desktop NFC). PasswordService.hash/verify both apply .normalize('NFC')
     * so either input form round-trips against either stored form.
     */
    it('verifies a password regardless of unicode normalization form (NFC/NFD)', async () => {
      const nfc = 'café'; // café, composed (U+00E9)
      const nfd = 'café'; // café, decomposed (e + U+0301)
      expect(nfc).not.toBe(nfd); // sanity: distinct byte sequences

      const hashFromNfc = await service.hash(nfc);
      expect(await service.verify(hashFromNfc, nfc)).toBe(true);
      expect(await service.verify(hashFromNfc, nfd)).toBe(true);

      const hashFromNfd = await service.hash(nfd);
      expect(await service.verify(hashFromNfd, nfc)).toBe(true);
      expect(await service.verify(hashFromNfd, nfd)).toBe(true);
    });
  });
});
