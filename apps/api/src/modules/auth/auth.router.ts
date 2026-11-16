import { Router, Mutation, Input, Ctx, UseMiddlewares } from 'nestjs-trpc';
import { z } from 'zod';
import { AppErrorCode } from '@repo/shared/errors';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  changePasswordSchema,
  deleteAccountSchema,
  authAckOutput,
  accountDeletedOutput,
  loginOutput,
  registerOutput,
  verifyTwoFactorSchema,
  resetPasswordTokenStateSchema,
  resetPasswordTokenStateOutput,
  confirmPasswordSchema,
  requestEmailChangeSchema,
  confirmEmailChangeSchema,
} from '@repo/shared/schemas';
import { ForbiddenError } from '../../common/errors';
import { RegisterService } from './services/register.service';
import { LoginService } from './services/login.service';
import { EmailVerificationService } from './services/email-verification.service';
import { PasswordResetService } from './services/password-reset.service';
import { PasswordChangeService } from './services/password-change.service';
import { AccountDeletionService } from './services/account-deletion.service';
import { SudoService } from './services/sudo.service';
import { EmailChangeService } from './services/email-change.service';
import { TwoFactorChallengeService } from './services/two-factor-challenge.service';
import { AuthMiddleware } from './middleware/auth.middleware';
import type { IAppContextType, IAuthenticatedContextType } from '../../trpc/trpc.context';
import { getClientIp, getUserAgent } from '../../common/utils/request';

@Router({ alias: 'auth' })
export class AuthRouter {
  constructor(
    private readonly registerService: RegisterService,
    private readonly loginService: LoginService,
    private readonly emailVerificationService: EmailVerificationService,
    private readonly passwordResetService: PasswordResetService,
    private readonly passwordChangeService: PasswordChangeService,
    private readonly accountDeletionService: AccountDeletionService,
    private readonly twoFactorChallengeService: TwoFactorChallengeService,
    private readonly sudoService: SudoService,
    private readonly emailChangeService: EmailChangeService,
  ) {}

  // ---------------------------------------------------------------------------
  // Public procedures (no auth required)
  // ---------------------------------------------------------------------------

  @Mutation({ input: registerSchema, output: registerOutput })
  async register(@Input() input: z.infer<typeof registerSchema>, @Ctx() ctx: IAppContextType) {
    const ip = getClientIp(ctx.req);
    const userAgent = getUserAgent(ctx.req);
    return this.registerService.register(input, ip, userAgent, ctx.req, ctx.res);
  }

  @Mutation({ input: loginSchema, output: loginOutput })
  async login(@Input() input: z.infer<typeof loginSchema>, @Ctx() ctx: IAppContextType) {
    const ip = getClientIp(ctx.req);
    const userAgent = getUserAgent(ctx.req);
    return this.loginService.login(input, ip, userAgent, ctx.req, ctx.res);
  }

  /**
   * Verify the second factor after `login` returned `twofa_required`. Public
   * (pre-session): the pending `__Host-2fa` cookie authorizes it, and the shared
   * pre-session csrf-sid double-submit still applies. Output is the login union;
   * on success it always resolves to the `ok` arm and establishes the session.
   */
  @Mutation({ input: verifyTwoFactorSchema, output: loginOutput })
  async verifyTwoFactor(
    @Input() input: z.infer<typeof verifyTwoFactorSchema>,
    @Ctx() ctx: IAppContextType,
  ) {
    const ip = getClientIp(ctx.req);
    const userAgent = getUserAgent(ctx.req);
    return this.twoFactorChallengeService.verifyChallenge(ctx.req, ctx.res, input, ip, userAgent);
  }

  @Mutation({ input: forgotPasswordSchema, output: authAckOutput })
  async forgotPassword(
    @Input() input: z.infer<typeof forgotPasswordSchema>,
    @Ctx() ctx: IAppContextType,
  ) {
    const ip = getClientIp(ctx.req);
    await this.passwordResetService.forgotPassword(input.email, input.turnstileToken, ip);
    return { success: true as const };
  }

  @Mutation({ input: resetPasswordSchema, output: authAckOutput })
  async resetPassword(
    @Input() input: z.infer<typeof resetPasswordSchema>,
    @Ctx() ctx: IAppContextType,
  ) {
    const ip = getClientIp(ctx.req);
    await this.passwordResetService.resetPassword(
      input.token,
      input.password,
      ip,
      input.factorCode,
    );
    return { success: true as const };
  }

  /**
   * Reset-form pre-check: is the token valid and does the account require a
   * second factor to complete the reset? A mutation so the secret token rides
   * the body, not a cacheable GET URL.
   */
  @Mutation({ input: resetPasswordTokenStateSchema, output: resetPasswordTokenStateOutput })
  async resetPasswordTokenState(
    @Input() input: z.infer<typeof resetPasswordTokenStateSchema>,
    @Ctx() ctx: IAppContextType,
  ) {
    const ip = getClientIp(ctx.req);
    return this.passwordResetService.getResetTokenState(input.token, ip);
  }

  @Mutation({ input: verifyEmailSchema, output: authAckOutput })
  async verifyEmail(
    @Input() input: z.infer<typeof verifyEmailSchema>,
    @Ctx() ctx: IAppContextType,
  ) {
    const ip = getClientIp(ctx.req);
    await this.emailVerificationService.verifyEmail(input.token, ip);
    return { success: true as const };
  }

  /**
   * Complete a pending email change from the link mailed to the NEW address.
   * Public like `verifyEmail`: the clicker may not be signed in anywhere, and
   * the single-use token is the credential. On success every session is
   * revoked; the user signs in again with the new address.
   */
  @Mutation({ input: confirmEmailChangeSchema, output: authAckOutput })
  async confirmEmailChange(
    @Input() input: z.infer<typeof confirmEmailChangeSchema>,
    @Ctx() ctx: IAppContextType,
  ) {
    const ip = getClientIp(ctx.req);
    await this.emailChangeService.confirmEmailChange(input.token, ip);
    return { success: true as const };
  }

  // ---------------------------------------------------------------------------
  // Protected procedures (requires valid session)
  // ---------------------------------------------------------------------------

  @Mutation({ output: authAckOutput })
  @UseMiddlewares(AuthMiddleware)
  async logout(@Ctx() ctx: IAuthenticatedContextType) {
    await this.loginService.logout(ctx.session.token, ctx.req, ctx.res);
    return { success: true as const };
  }

  @Mutation({ output: authAckOutput })
  @UseMiddlewares(AuthMiddleware)
  async logoutAll(@Ctx() ctx: IAuthenticatedContextType) {
    await this.loginService.logoutAll(ctx.user.id, ctx.req, ctx.res);
    return { success: true as const };
  }

  @Mutation({ input: resendVerificationSchema, output: authAckOutput })
  @UseMiddlewares(AuthMiddleware)
  async resendVerification(
    @Input() input: z.infer<typeof resendVerificationSchema>,
    @Ctx() ctx: IAuthenticatedContextType,
  ) {
    const ip = getClientIp(ctx.req);
    await this.emailVerificationService.resendVerification(ctx.user.id, input.turnstileToken, ip);
    return { success: true as const };
  }

  /**
   * Sudo gate: re-verify the current password and mark THIS session
   * recently-confirmed for 5 minutes. `requestEmailChange` requires the mark.
   * An account with no password (null passwordHash) gets PASSWORD_NOT_SET,
   * whose copy points at password reset (which doubles as set-password).
   */
  @Mutation({ input: confirmPasswordSchema, output: authAckOutput })
  @UseMiddlewares(AuthMiddleware)
  async confirmPassword(
    @Input() input: z.infer<typeof confirmPasswordSchema>,
    @Ctx() ctx: IAuthenticatedContextType,
  ) {
    await this.sudoService.confirmPassword(ctx.user.id, ctx.session.id, input.password);
    return { success: true as const };
  }

  @Mutation({ input: changePasswordSchema, output: authAckOutput })
  @UseMiddlewares(AuthMiddleware)
  async changePassword(
    @Input() input: z.infer<typeof changePasswordSchema>,
    @Ctx() ctx: IAuthenticatedContextType,
  ) {
    const ip = getClientIp(ctx.req);
    const userAgent = getUserAgent(ctx.req);
    await this.passwordChangeService.changePassword(
      ctx.user.id,
      input.currentPassword,
      input.newPassword,
      ip,
      userAgent,
      ctx.req,
      ctx.res,
    );
    return { success: true as const };
  }

  /**
   * Start an email change for the signed-in user. Requires the sudo flag
   * minted by `auth.confirmPassword` (a FORBIDDEN answer re-prompts: a stolen
   * session cookie alone must not be able to move the login identity), plus a second-factor code inside the
   * service when 2FA is active. The change only takes effect once the NEW
   * address consumes the mailed link (`confirmEmailChange`).
   */
  @Mutation({ input: requestEmailChangeSchema, output: authAckOutput })
  @UseMiddlewares(AuthMiddleware)
  async requestEmailChange(
    @Input() input: z.infer<typeof requestEmailChangeSchema>,
    @Ctx() ctx: IAuthenticatedContextType,
  ) {
    if (!(await this.sudoService.isActive(ctx.session.id))) {
      // FORBIDDEN is the settings form's re-prompt signal: it reopens the
      // password dialog (auth.confirmPassword) and retries. No dedicated
      // appCode: the state is simply "not recently confirmed".
      throw new ForbiddenError(
        AppErrorCode.FORBIDDEN,
        'Confirm your password to change your email address',
      );
    }
    const ip = getClientIp(ctx.req);
    const userAgent = getUserAgent(ctx.req);
    await this.emailChangeService.requestEmailChange(
      ctx.user.id,
      input.newEmail,
      input.factorCode,
      ip,
      userAgent,
    );
    return { success: true as const };
  }

  /**
   * Delete the caller's own account (soft delete + 30-day purge grace),
   * confirmed with the current password. Every session is revoked and the
   * session cookie cleared, so the client is logged out by construction.
   */
  @Mutation({ input: deleteAccountSchema, output: accountDeletedOutput })
  @UseMiddlewares(AuthMiddleware)
  async deleteAccount(
    @Input() input: z.infer<typeof deleteAccountSchema>,
    @Ctx() ctx: IAuthenticatedContextType,
  ) {
    const ip = getClientIp(ctx.req);
    const userAgent = getUserAgent(ctx.req);
    await this.accountDeletionService.deleteAccount(
      ctx.user.id,
      input.password,
      ip,
      userAgent,
      ctx.req,
      ctx.res,
    );
    return { deleted: true as const };
  }
}
