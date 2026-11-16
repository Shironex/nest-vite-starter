import { esmImport } from '../../common/utils/esm-import';
import { EmailRendererService } from './email-renderer.service';

// `@repo/email` is ESM-only and this suite runs as CJS, so the real module
// cannot be loaded here; that seam (esmImport) is the one thing replaced.
jest.mock('../../common/utils/esm-import', () => ({ esmImport: jest.fn() }));

/** Every public render method, so a method wired to the wrong template fails by name. */
const RENDER_METHODS = [
  'renderVerificationEmail',
  'renderPasswordResetEmail',
  'renderWelcomeEmail',
  'renderPasswordChangedEmail',
  'renderTwoFactorEnabledEmail',
  'renderTwoFactorDisabledEmail',
  'renderRecoveryCodeUsedEmail',
  'renderTwoFactorAdminResetEmail',
  'renderTwoFactorPolicyAnnouncementEmail',
  'renderTwoFactorEnforcementReminderEmail',
  'renderTwoFactorSupportResetContestEmail',
  'renderOAuthAccountLinkedEmail',
  'renderEmailChangeVerificationEmail',
  'renderEmailChangeRequestedEmail',
  'renderStaffInviteEmail',
  'renderStaffInviteJoinAndCloseEmail',
] as const;

type IRenderFn = (props: unknown) => Promise<string>;

/** A fake `@repo/email` whose every renderer answers with its own name. */
function buildEmailModule(): Record<(typeof RENDER_METHODS)[number], jest.Mock<Promise<string>>> {
  return Object.fromEntries(
    RENDER_METHODS.map((name) => [name, jest.fn().mockResolvedValue(`<html>${name}</html>`)]),
  ) as Record<(typeof RENDER_METHODS)[number], jest.Mock<Promise<string>>>;
}

describe('EmailRendererService', () => {
  let emailModule: ReturnType<typeof buildEmailModule>;
  let service: EmailRendererService;

  beforeEach(() => {
    emailModule = buildEmailModule();
    jest.mocked(esmImport).mockReset().mockResolvedValue(emailModule);
    service = new EmailRendererService();
  });

  it.each(RENDER_METHODS)(
    '%s hands its props to the matching template and returns the HTML',
    async (method) => {
      const props = { marker: method };

      const html = await (service[method] as unknown as IRenderFn)(props);

      expect(html).toBe(`<html>${method}</html>`);
      expect(emailModule[method]).toHaveBeenCalledTimes(1);
      expect(emailModule[method]).toHaveBeenCalledWith(props);
      // No other template was rendered by mistake.
      for (const other of RENDER_METHODS.filter((name) => name !== method)) {
        expect(emailModule[other]).not.toHaveBeenCalled();
      }
    },
  );

  it('loads @repo/email lazily, on the first render and not at construction', async () => {
    expect(esmImport).not.toHaveBeenCalled();

    await service.renderWelcomeEmail({} as never);

    expect(esmImport).toHaveBeenCalledTimes(1);
    expect(esmImport).toHaveBeenCalledWith('@repo/email');
  });

  it('evaluates the ESM module once per instance across many renders', async () => {
    await service.renderWelcomeEmail({} as never);
    await service.renderVerificationEmail({} as never);
    await service.renderPasswordResetEmail({} as never);

    expect(esmImport).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed module load to the caller instead of returning empty HTML', async () => {
    jest.mocked(esmImport).mockReset().mockRejectedValue(new Error('ERR_REQUIRE_ESM'));

    await expect(service.renderWelcomeEmail({} as never)).rejects.toThrow('ERR_REQUIRE_ESM');
  });

  it('surfaces a template render failure to the caller', async () => {
    emailModule.renderWelcomeEmail.mockRejectedValue(new Error('template exploded'));

    await expect(service.renderWelcomeEmail({} as never)).rejects.toThrow('template exploded');
  });
});
