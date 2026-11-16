import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { EncryptionService } from './encryption.service';

// A valid 32-byte key, supplied in base64 (the documented format).
const KEY_B64 = randomBytes(32).toString('base64');
const KEY_HEX = randomBytes(32).toString('hex');

const buildSubject = async (encryptionKey: string | undefined) => {
  const config = {
    get: jest.fn((k: string) => ({ ENCRYPTION_KEY: encryptionKey })[k]),
  };
  const module = await Test.createTestingModule({
    providers: [EncryptionService, { provide: ConfigService, useValue: config }],
  }).compile();
  const service = module.get(EncryptionService);
  service.onModuleInit();
  return service;
};

describe('EncryptionService', () => {
  describe('key validation (fail fast at boot)', () => {
    it('accepts a base64 32-byte key', async () => {
      await expect(buildSubject(KEY_B64)).resolves.toBeInstanceOf(EncryptionService);
    });

    it('accepts a hex 32-byte key', async () => {
      await expect(buildSubject(KEY_HEX)).resolves.toBeInstanceOf(EncryptionService);
    });

    it('throws when ENCRYPTION_KEY is missing', async () => {
      await expect(buildSubject(undefined)).rejects.toThrow(/ENCRYPTION_KEY is required/);
    });

    it('throws when the key decodes to the wrong length', async () => {
      const shortKey = randomBytes(16).toString('base64');
      await expect(buildSubject(shortKey)).rejects.toThrow(/exactly 32 bytes/);
    });

    it('does not leak the key material in the error message', async () => {
      const shortKey = randomBytes(16).toString('base64');
      await expect(buildSubject(shortKey)).rejects.not.toThrow(shortKey);
    });

    it('rejects an all-zero 32-byte key (base64 "AAA...A=")', async () => {
      // 32 zero bytes encode to exactly 44 base64 chars: passes length but must
      // fail the entropy gate.
      const allZero = Buffer.alloc(32, 0).toString('base64');
      await expect(buildSubject(allZero)).rejects.toThrow(/too weak/);
    });

    it('rejects an all-identical-byte key (e.g. 32x 0xFF)', async () => {
      const allFF = Buffer.alloc(32, 0xff).toString('base64');
      await expect(buildSubject(allFF)).rejects.toThrow(/too weak/);
    });

    it('rejects a low-diversity key (32 bytes, < 16 distinct values)', async () => {
      // A repeated short pattern: 32 bytes built from only 4 distinct values,
      // passes the length check but is well below the diversity floor (a real
      // random key has ~28 distinct bytes). Models a padded placeholder.
      const pattern = Buffer.from([0x00, 0x01, 0x02, 0x03]);
      const lowDiversity = Buffer.concat(Array.from({ length: 8 }, () => pattern));
      expect(lowDiversity.length).toBe(32);
      await expect(buildSubject(lowDiversity.toString('base64'))).rejects.toThrow(/too weak/);
    });

    it('accepts a real `openssl rand -base64 32` key (high byte diversity)', async () => {
      // randomBytes(32) mirrors what `openssl rand -base64 32` produces, well
      // above the 16-distinct-byte floor, so it must clear the entropy gate.
      const opensslLike = randomBytes(32).toString('base64');
      await expect(buildSubject(opensslLike)).resolves.toBeInstanceOf(EncryptionService);
    });

    it('accepts a randomly-generated base64 key with sufficient entropy', async () => {
      // randomBytes(32) virtually never produces a single repeated byte.
      await expect(buildSubject(KEY_B64)).resolves.toBeInstanceOf(EncryptionService);
    });
  });

  describe('encrypt / decrypt round-trip', () => {
    it('decrypt(encrypt(x)) === x', async () => {
      const service = await buildSubject(KEY_B64);
      const plaintext = 'a-reversible-secret-value';
      expect(service.decrypt(service.encrypt(plaintext))).toBe(plaintext);
    });

    it('round-trips an empty string', async () => {
      const service = await buildSubject(KEY_B64);
      expect(service.decrypt(service.encrypt(''))).toBe('');
    });

    it('round-trips unicode / multi-byte content', async () => {
      const service = await buildSubject(KEY_B64);
      const plaintext = 'key 🔐 naïve café façade';
      expect(service.decrypt(service.encrypt(plaintext))).toBe(plaintext);
    });

    it('emits the versioned v1.<iv>.<tag>.<ciphertext> wire format', async () => {
      const service = await buildSubject(KEY_B64);
      const out = service.encrypt('hello');
      expect(out).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    });
  });

  describe('confidentiality + IV uniqueness', () => {
    it('ciphertext does not contain the plaintext', async () => {
      const service = await buildSubject(KEY_B64);
      const plaintext = 'super-secret-plaintext';
      expect(service.encrypt(plaintext)).not.toContain(plaintext);
    });

    it('produces different ciphertext for two encryptions of the same input (random IV)', async () => {
      const service = await buildSubject(KEY_B64);
      const plaintext = 'same-input';
      const a = service.encrypt(plaintext);
      const b = service.encrypt(plaintext);
      expect(a).not.toBe(b);
      // Both still decrypt back to the original.
      expect(service.decrypt(a)).toBe(plaintext);
      expect(service.decrypt(b)).toBe(plaintext);
    });
  });

  describe('integrity (fail closed on tampering)', () => {
    /** The four `v.iv.tag.ct` segments of an envelope `encrypt` just produced. */
    const segments = (envelope: string) => envelope.split('.') as [string, string, string, string];

    it('throws when the ciphertext segment is tampered with', async () => {
      const service = await buildSubject(KEY_B64);
      const [v, iv, tag, ct] = segments(service.encrypt('payload'));
      const tampered = ct[0] === 'A' ? 'B' : 'A';
      const corrupted = [v, iv, tag, tampered + ct.slice(1)].join('.');
      expect(() => service.decrypt(corrupted)).toThrow();
    });

    it('throws when the auth tag is tampered with', async () => {
      const service = await buildSubject(KEY_B64);
      const [v, iv, tag, ct] = segments(service.encrypt('payload'));
      const flipped = tag[0] === 'A' ? 'B' : 'A';
      const corrupted = [v, iv, flipped + tag.slice(1), ct].join('.');
      expect(() => service.decrypt(corrupted)).toThrow();
    });

    it('throws when decrypting with a different key', async () => {
      const a = await buildSubject(KEY_B64);
      const b = await buildSubject(randomBytes(32).toString('base64'));
      expect(() => b.decrypt(a.encrypt('payload'))).toThrow();
    });

    it('rejects an unknown version prefix', async () => {
      const service = await buildSubject(KEY_B64);
      const [, iv, tag, ct] = service.encrypt('payload').split('.');
      const future = ['v2', iv, tag, ct].join('.');
      expect(() => service.decrypt(future)).toThrow(/Unsupported ciphertext version/);
    });

    it('rejects a malformed payload (wrong number of parts)', async () => {
      const service = await buildSubject(KEY_B64);
      expect(() => service.decrypt('v1.only-two')).toThrow(/Malformed ciphertext/);
    });

    it('rejects an IV of the wrong length', async () => {
      const service = await buildSubject(KEY_B64);
      const [v, , tag, ct] = service.encrypt('payload').split('.');
      const badIv = randomBytes(8).toString('base64url');
      expect(() => service.decrypt([v, badIv, tag, ct].join('.'))).toThrow(/Malformed ciphertext/);
    });
  });
});
