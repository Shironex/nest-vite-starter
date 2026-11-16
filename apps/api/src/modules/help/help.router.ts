import { Router, Query, Mutation, Ctx, Input, UseMiddlewares } from 'nestjs-trpc';
import type { z } from 'zod';
import { tourProgressOutput, tourProgressSaveInput } from '@repo/shared/schemas';
import { AuthMiddleware } from '../auth/middleware/auth.middleware';
import { IdempotencyMiddleware } from '../../common/idempotency/idempotency.middleware';
import type { IAuthenticatedContextType } from '../../trpc/trpc.context';
import { TourProgressService } from './tour-progress.service';

/**
 * In-app help. Today that is exactly one thing: which guided tours the caller
 * has already been shown.
 *
 * Class-level `@UseMiddlewares(AuthMiddleware)` gates every procedure and each
 * one operates strictly on `ctx.user.id`, so there is no id on any input that
 * names a user and therefore no IDOR surface.
 *
 * Every procedure declares an `output:` schema: without one nestjs-trpc
 * generates `as any` and poisons the client types.
 */
@Router({ alias: 'help' })
@UseMiddlewares(AuthMiddleware)
export class HelpRouter {
  constructor(private readonly tourProgressService: TourProgressService) {}

  /**
   * `help.progressGet`: the caller's tour map, empty while no row exists.
   * Strictly self-serve, like the notification preferences it is modeled on.
   */
  @Query({ output: tourProgressOutput })
  async progressGet(@Ctx() ctx: IAuthenticatedContextType) {
    return this.tourProgressService.getForUser(ctx.user.id);
  }

  /**
   * `help.progressSave`: record that one tour was finished or dismissed.
   *
   * Carries IdempotencyMiddleware for the same reason
   * `notifications.preferencesUpdate` does: the first save of a user's life is
   * a row CREATE, and a network retry must not race itself into the P2002
   * conflict path.
   */
  @Mutation({ input: tourProgressSaveInput, output: tourProgressOutput })
  @UseMiddlewares(AuthMiddleware, IdempotencyMiddleware)
  async progressSave(
    @Ctx() ctx: IAuthenticatedContextType,
    @Input() input: z.infer<typeof tourProgressSaveInput>,
  ) {
    return this.tourProgressService.saveForUser(ctx.user.id, input);
  }

  /**
   * `help.progressResetAll`: forget every tour, so all of them are offered
   * again. No IdempotencyMiddleware: it writes a constant (the empty map), so a
   * replay is a no-op by construction, which is the same reasoning
   * `notifications.markAllRead` is exempted under.
   */
  @Mutation({ output: tourProgressOutput })
  async progressResetAll(@Ctx() ctx: IAuthenticatedContextType) {
    return this.tourProgressService.resetForUser(ctx.user.id);
  }
}
