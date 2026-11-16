import { Router, Query, Mutation, Input, Ctx, UseMiddlewares } from 'nestjs-trpc';
import { z } from 'zod';
import { AppErrorCode } from '@repo/shared/errors';
import { authAckOutput, oauthAccountsOutput, unlinkOAuthAccountSchema } from '@repo/shared/schemas';
import { ForbiddenError } from '../../../common/errors';
import { getClientIp, getUserAgent } from '../../../common/utils/request';
import type { IAuthenticatedContextType } from '../../../trpc/trpc.context';
import { AuthMiddleware } from '../middleware/auth.middleware';
import { SudoService } from '../services/sudo.service';
import { OAuthAccountService } from './oauth-account.service';

/**
 * The Connected Accounts tRPC surface (Google sign-in SPEC section 8). The
 * redirect halves of the feature (start/callback) live on OAuthController;
 * everything a signed-in settings panel reads or mutates lives here.
 *
 * `unlink` requires the sudo flag minted by `auth.confirmPassword`: a stolen
 * session cookie alone must not be able to strip a sign-in method. Linking is
 * gated the same way, but at the /start redirect, not here.
 */
@Router({ alias: 'oauth' })
export class OAuthAccountsRouter {
  constructor(
    private readonly oauthAccountService: OAuthAccountService,
    private readonly sudoService: SudoService,
  ) {}

  @Query({ output: oauthAccountsOutput })
  @UseMiddlewares(AuthMiddleware)
  async listAccounts(@Ctx() ctx: IAuthenticatedContextType) {
    return { accounts: await this.oauthAccountService.listAccounts(ctx.user.id) };
  }

  @Mutation({ input: unlinkOAuthAccountSchema, output: authAckOutput })
  @UseMiddlewares(AuthMiddleware)
  async unlink(
    @Input() input: z.infer<typeof unlinkOAuthAccountSchema>,
    @Ctx() ctx: IAuthenticatedContextType,
  ) {
    if (!(await this.sudoService.isActive(ctx.session.id))) {
      // FORBIDDEN is the panel's re-prompt signal: it reopens the password
      // dialog (auth.confirmPassword) and retries. No dedicated appCode:
      // the state is simply "not recently confirmed".
      throw new ForbiddenError(
        AppErrorCode.FORBIDDEN,
        'Confirm your password to manage connected accounts',
      );
    }
    await this.oauthAccountService.unlink(ctx.user.id, input.accountId, {
      ip: getClientIp(ctx.req),
      userAgent: getUserAgent(ctx.req),
    });
    return { success: true as const };
  }
}
