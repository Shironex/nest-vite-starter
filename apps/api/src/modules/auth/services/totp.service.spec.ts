import { Logger } from '@nestjs/common';
import * as OTPAuth from 'otpauth';
import { TotpService } from './totp.service';
import { EncryptionService } from '../../../common/security/encryption.service';
import { totpDecryptFailuresTotal } from '../../metrics/metrics.registry';
import { createAuthTestModule } from '@test/test-module';
import { TOTP_ALGORITHM, TOTP_DIGITS, TOTP_PERIOD_SECONDS } from '../auth.constants';

describe('TotpService', () => {
  const build = async (encryption: Partial<EncryptionService>) => {
    const ctx = await createAuthTestModule({
      providers: [TotpService, { provide: EncryptionService, useValue: encryption }],
      configDefaults: { APP_NAME: 'TestApp' },
    });
    return { ...ctx, service: ctx.get(TotpService) };
  };

  /** The valid code for `base32` at the current instant (matches the service's live clock). */
  const currentCode = (base32: string): string =>
    new OTPAuth.TOTP({
      issuer: 'TestApp',
      label: 'u',
      algorithm: TOTP_ALGORITHM,
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD_SECONDS,
      secret: OTPAuth.Secret.fromBase32(base32),
    }).generate();

  it('generateSecret returns a base32 secret and an otpauth URI embedding it', async () => {
    const { service } = await build({ encrypt: jest.fn(), decrypt: jest.fn() });
    const { secretBase32, otpauthUri } = service.generateSecret('user@example.com');
    expect(secretBase32).toMatch(/^[A-Z2-7]+$/);
    expect(otpauthUri).toContain('otpauth://totp/');
    expect(otpauthUri).toContain(`secret=${secretBase32}`);
    expect(otpauthUri).toContain('issuer=TestApp');
  });

  it('encryptSecret delegates to EncryptionService', async () => {
    const encrypt = jest.fn().mockReturnValue('enc-blob');
    const { service } = await build({ encrypt, decrypt: jest.fn() });
    expect(service.encryptSecret('JBSWY3DP')).toBe('enc-blob');
    expect(encrypt).toHaveBeenCalledWith('JBSWY3DP');
  });

  it('verify accepts a valid current code and claims the replay slot (SETNX)', async () => {
    const base32 = new OTPAuth.Secret({ size: 20 }).base32;
    const decrypt = jest.fn().mockReturnValue(base32);
    const { service, mocks } = await build({ encrypt: jest.fn(), decrypt });
    mocks.redis.set.mockResolvedValue('OK');

    await expect(service.verify('u-1', 'enc', currentCode(base32))).resolves.toBe(true);
    expect(decrypt).toHaveBeenCalledWith('enc');
    expect(mocks.redis.set).toHaveBeenCalledWith(
      expect.stringContaining('twofa_used:u-1:'),
      '1',
      'EX',
      expect.any(Number),
      'NX',
    );
  });

  it('verify rejects a replayed code (SETNX loses the claim on the second submit)', async () => {
    const base32 = new OTPAuth.Secret({ size: 20 }).base32;
    const { service, mocks } = await build({
      encrypt: jest.fn(),
      decrypt: jest.fn().mockReturnValue(base32),
    });
    mocks.redis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

    const code = currentCode(base32);
    await expect(service.verify('u-1', 'enc', code)).resolves.toBe(true);
    await expect(service.verify('u-1', 'enc', code)).resolves.toBe(false);
  });

  it('verify rejects a malformed code without claiming a slot, logging, or counting', async () => {
    const base32 = new OTPAuth.Secret({ size: 20 }).base32;
    const { service, mocks } = await build({
      encrypt: jest.fn(),
      decrypt: jest.fn().mockReturnValue(base32),
    });
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const incSpy = jest.spyOn(totpDecryptFailuresTotal, 'inc');

    await expect(service.verify('u-1', 'enc', 'not-a-code')).resolves.toBe(false);
    expect(mocks.redis.set).not.toHaveBeenCalled();
    // A decryptable-but-wrong code is an ordinary failure: it must stay silent
    // and unmetered so the decrypt-failure counter isolates key rotations.
    expect(warnSpy).not.toHaveBeenCalled();
    expect(incSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    incSpy.mockRestore();
  });

  it('verify fails closed and logs+counts when the secret cannot be decrypted', async () => {
    const decrypt = jest.fn(() => {
      throw new Error('tampered');
    });
    const { service, mocks } = await build({ encrypt: jest.fn(), decrypt });
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const incSpy = jest.spyOn(totpDecryptFailuresTotal, 'inc');

    await expect(service.verify('u-1', 'ciphertext-blob', '998877')).resolves.toBe(false);
    expect(mocks.redis.set).not.toHaveBeenCalled();
    expect(incSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // Operator context (userId) is allowed; the ciphertext, decrypted secret,
    // and submitted code must never appear in the log line.
    const warned = JSON.stringify(warnSpy.mock.calls);
    expect(warned).toContain('u-1');
    expect(warned).not.toContain('ciphertext-blob');
    expect(warned).not.toContain('998877');

    warnSpy.mockRestore();
    incSpy.mockRestore();
  });
});
