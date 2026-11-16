import { Router, Query, Mutation, Input, Ctx, UseMiddlewares } from 'nestjs-trpc';
import { z } from 'zod';
import {
  twoFactorBeginEnrollmentSchema,
  twoFactorSetupOutput,
  twoFactorActivateSchema,
  twoFactorRecoveryCodesOutput,
  twoFactorDisableSchema,
  twoFactorRegenerateSchema,
  twoFactorStatusOutput,
  resetMemberTwoFactorSchema,
  authAckOutput,
} from '@repo/shared/schemas';
import { TwoFactorService } from './services/two-factor.service';
import { TwoFactorAdminResetService } from './services/two-factor-admin-reset.service';
import { AuthMiddleware } from './middleware/auth.middleware';
import { AdminMiddleware } from './middleware/role.middleware';
import type { IAuthenticatedContextType } from '../../trpc/trpc.context';
import { getClientIp, getUserAgent } from '../../common/utils/request';

/**
 * Protected 2FA management surface. Every procedure requires a valid session
 * (AuthMiddleware); the mutating ones additionally require the current password
 * inside the service (sudo gate). The pre-session login CHALLENGE lives on the
 * public `auth` router, not here.
 */
@Router({ alias: 'twoFactor' })
export class TwoFactorRouter {
  constructor(
    private readonly twoFactorService: TwoFactorService,
    private readonly twoFactorAdminResetService: TwoFactorAdminResetService,
  ) {}

  @Query({ output: twoFactorStatusOutput })
  @UseMiddlewares(AuthMiddleware)
  async status(@Ctx() ctx: IAuthenticatedContextType) {
    return this.twoFactorService.status(ctx.user.id);
  }

  @Mutation({ input: twoFactorBeginEnrollmentSchema, output: twoFactorSetupOutput })
  @UseMiddlewares(AuthMiddleware)
  async beginEnrollment(
    @Input() input: z.infer<typeof twoFactorBeginEnrollmentSchema>,
    @Ctx() ctx: IAuthenticatedContextType,
  ) {
    const ip = getClientIp(ctx.req);
    const userAgent = getUserAgent(ctx.req);
    return this.twoFactorService.beginEnrollment(ctx.user.id, input.password, ip, userAgent);
  }

  @Mutation({ input: twoFactorActivateSchema, output: twoFactorRecoveryCodesOutput })
  @UseMiddlewares(AuthMiddleware)
  async activate(
    @Input() input: z.infer<typeof twoFactorActivateSchema>,
    @Ctx() ctx: IAuthenticatedContextType,
  ) {
    const ip = getClientIp(ctx.req);
    const userAgent = getUserAgent(ctx.req);
    return this.twoFactorService.activate(ctx.user.id, input.code, ip, userAgent);
  }

  @Mutation({ input: twoFactorDisableSchema, output: authAckOutput })
  @UseMiddlewares(AuthMiddleware)
  async disable(
    @Input() input: z.infer<typeof twoFactorDisableSchema>,
    @Ctx() ctx: IAuthenticatedContextType,
  ) {
    const ip = getClientIp(ctx.req);
    const userAgent = getUserAgent(ctx.req);
    await this.twoFactorService.disable(ctx.user.id, input.password, input.code, ip, userAgent);
    return { success: true as const };
  }

  @Mutation({ input: twoFactorRegenerateSchema, output: twoFactorRecoveryCodesOutput })
  @UseMiddlewares(AuthMiddleware)
  async regenerateRecoveryCodes(
    @Input() input: z.infer<typeof twoFactorRegenerateSchema>,
    @Ctx() ctx: IAuthenticatedContextType,
  ) {
    const ip = getClientIp(ctx.req);
    const userAgent = getUserAgent(ctx.req);
    return this.twoFactorService.regenerateRecoveryCodes(
      ctx.user.id,
      input.password,
      ip,
      userAgent,
    );
  }

  @Mutation({ output: authAckOutput })
  @UseMiddlewares(AuthMiddleware)
  async revokeTrustedDevices(@Ctx() ctx: IAuthenticatedContextType) {
    const ip = getClientIp(ctx.req);
    const userAgent = getUserAgent(ctx.req);
    await this.twoFactorService.revokeTrustedDevices(ctx.user.id, ip, userAgent);
    return { success: true as const };
  }

  // ---------------------------------------------------------------------------
  // Admin procedure.
  // ---------------------------------------------------------------------------

  @Mutation({ input: resetMemberTwoFactorSchema, output: authAckOutput })
  @UseMiddlewares(AuthMiddleware, AdminMiddleware)
  async resetMemberTwoFactor(
    @Input() input: z.infer<typeof resetMemberTwoFactorSchema>,
    @Ctx() ctx: IAuthenticatedContextType,
  ) {
    const ip = getClientIp(ctx.req);
    const userAgent = getUserAgent(ctx.req);
    await this.twoFactorAdminResetService.resetMemberTwoFactor(
      ctx.user.id,
      input.userId,
      ip,
      userAgent,
    );
    return { success: true as const };
  }
}
