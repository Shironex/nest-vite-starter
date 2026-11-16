import { TwoFactorEnrollmentReader } from './two-factor-enrollment.reader';

type PolicyRow = { required: boolean; graceEndsAt: Date | null } | null;

const build = (policy: PolicyRow, activeFactor: unknown = null) => {
  const findUnique = jest.fn().mockResolvedValue(policy);
  const findActiveNonRecovery = jest.fn().mockResolvedValue(activeFactor);
  const prisma = { unscoped: { twoFactorPolicy: { findUnique } } };
  const secondFactor = { findActiveNonRecovery };
  const reader = new TwoFactorEnrollmentReader(
    prisma as unknown as ConstructorParameters<typeof TwoFactorEnrollmentReader>[0],
    secondFactor as unknown as ConstructorParameters<typeof TwoFactorEnrollmentReader>[1],
  );
  return { reader, findUnique, findActiveNonRecovery };
};

const past = () => new Date(Date.now() - 60_000);
const future = () => new Date(Date.now() + 60_000);

describe('TwoFactorEnrollmentReader.isEnrollmentStillRequired', () => {
  it('returns false (no reads) for a tenant-less session', async () => {
    const { reader, findUnique, findActiveNonRecovery } = build({
      required: true,
      graceEndsAt: past(),
    });
    expect(await reader.isEnrollmentStillRequired('u-1', null)).toBe(false);
    expect(await reader.isEnrollmentStillRequired('u-1', undefined)).toBe(false);
    expect(findUnique).not.toHaveBeenCalled();
    expect(findActiveNonRecovery).not.toHaveBeenCalled();
  });

  it('returns false when the tenant has no policy', async () => {
    const { reader } = build(null);
    expect(await reader.isEnrollmentStillRequired('u-1', 'ten-1')).toBe(false);
  });

  it('returns false when the policy does not require 2FA', async () => {
    const { reader } = build({ required: false, graceEndsAt: null });
    expect(await reader.isEnrollmentStillRequired('u-1', 'ten-1')).toBe(false);
  });

  it('returns false when required but the grace window has not passed', async () => {
    const { reader } = build({ required: true, graceEndsAt: future() });
    expect(await reader.isEnrollmentStillRequired('u-1', 'ten-1')).toBe(false);
  });

  it('returns false when required + past grace but the member already has an active factor', async () => {
    const { reader } = build({ required: true, graceEndsAt: past() }, { id: 'f-1' });
    expect(await reader.isEnrollmentStillRequired('u-1', 'ten-1')).toBe(false);
  });

  it('returns true when required, past grace, and the member has no active factor', async () => {
    const { reader, findUnique, findActiveNonRecovery } = build({
      required: true,
      graceEndsAt: past(),
    });
    expect(await reader.isEnrollmentStillRequired('u-1', 'ten-1')).toBe(true);
    expect(findUnique).toHaveBeenCalledWith({ where: { tenantId: 'ten-1' } });
    expect(findActiveNonRecovery).toHaveBeenCalledWith('u-1');
  });
});
