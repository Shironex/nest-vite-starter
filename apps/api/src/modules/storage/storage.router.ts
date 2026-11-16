import { Logger } from '@nestjs/common';
import { Router, Mutation, Query, Ctx, Input, UseMiddlewares } from 'nestjs-trpc';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { AUDIT_ACTIONS } from '@repo/shared/audit';
import { StorageService } from './storage.service';
import { AvatarOwnerPort } from './avatar-owner.port';
import { AuthMiddleware } from '../auth/middleware/auth.middleware';
import { IdempotencyMiddleware } from '../../common/idempotency/idempotency.middleware';
import { AuditService } from '../audit/audit.service';
import type { IAuthenticatedContextType } from '../../trpc/trpc.context';
import {
  uploadRequestSchema,
  uploadResponseSchema,
  getUrlSchema,
  getUrlOutput,
  deleteFileSchema,
  ackOutput,
  ALLOWED_IMAGE_TYPES,
  avatarKeyPrefix,
} from '@repo/shared/schemas';

@Router({ alias: 'storage' })
@UseMiddlewares(AuthMiddleware)
export class StorageRouter {
  private readonly logger = new Logger(StorageRouter.name);

  constructor(
    private readonly storageService: StorageService,
    private readonly avatarOwner: AvatarOwnerPort,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Request a presigned upload POST policy.
   * Generates a user-scoped key and returns the policy (url + form fields,
   * with the size cap enforced by S3 via content-length-range) plus a
   * download URL.
   *
   * NO IdempotencyMiddleware, deliberately, and it used to carry one. The
   * response is a CAPABILITY with a 300 s life (`UPLOAD_URL_TTL_SECONDS`),
   * while the idempotency record lives 24 h: a replay outside that first five
   * minutes would hand the caller a policy that is already dead, with nothing
   * in the response to say so. That is strictly worse than minting a fresh one,
   * which is cheap and always works. Nothing durable is created here either,
   * so a second mint costs an unused object key and no row.
   *
   * The double-submit case the middleware was there for is covered where it can
   * actually be observed: `FileUploadZone.hooks.ts` holds an in-flight set of
   * file names, so a fast re-pick of the same file cannot start a second
   * upload.
   */
  @Mutation({ input: uploadRequestSchema, output: uploadResponseSchema })
  @UseMiddlewares(AuthMiddleware)
  async requestUpload(
    @Ctx() ctx: IAuthenticatedContextType,
    @Input() input: z.infer<typeof uploadRequestSchema>,
  ) {
    const userId = ctx.user.id;
    // Derive the stored extension from the validated MIME type, never from the
    // client-supplied filename (which could smuggle `.svg`/`.html`).
    const ext = ALLOWED_IMAGE_TYPES[input.contentType];
    const key = `${avatarKeyPrefix(userId)}${randomUUID()}.${ext}`;

    const { url, fields } = await this.storageService.createUploadPost(key, input.contentType);
    const downloadUrl = await this.storageService.getDownloadUrl(key);

    // Boundary record: presigning grants a time-limited write capability, so
    // leave one structured line per grant (the comparable data-export surface
    // records every access). Key is app-generated (uuid), not user input.
    this.logger.log('Storage upload POST policy presigned', {
      op: 'storage.presign',
      userId,
      key,
    });

    return { url, fields, key, downloadUrl };
  }

  /**
   * Get a presigned download URL for a stored file.
   */
  @Query({ input: getUrlSchema, output: getUrlOutput })
  async getUrl(@Ctx() ctx: IAuthenticatedContextType, @Input() input: { key: string }) {
    const userId = ctx.user.id;
    if (!input.key.startsWith(avatarKeyPrefix(userId))) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You can only access your own files',
      });
    }

    const downloadUrl = await this.storageService.getDownloadUrl(input.key);
    return { downloadUrl };
  }

  /**
   * Delete a file from storage.
   * Validates the key belongs to the requesting user.
   */
  @Mutation({ input: deleteFileSchema, output: ackOutput })
  @UseMiddlewares(AuthMiddleware, IdempotencyMiddleware)
  async deleteFile(@Ctx() ctx: IAuthenticatedContextType, @Input() input: { key: string }) {
    const userId = ctx.user.id;
    if (!input.key.startsWith(avatarKeyPrefix(userId))) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You can only delete your own files',
      });
    }

    await this.storageService.delete(input.key);

    // Destructive op: one structured boundary line plus an audit row (who
    // deleted which object; ip/userAgent/tenant ride the ALS fallback inside
    // AuditService). The ownership check above already scoped the key to the
    // caller, so the key is safe to record.
    this.logger.log('Storage object deleted', { op: 'storage.delete', userId, key: input.key });
    await this.auditService.log({
      action: AUDIT_ACTIONS.STORAGE_FILE_DELETED,
      userId,
      targetType: 'StorageObject',
      targetId: input.key,
    });

    // If the deleted object backed the caller's current avatar, clear the
    // reference so User.avatarUrl does not dangle on a missing S3 key. The
    // compare-and-swap (soft-delete guarded) only clears on an exact key
    // match, so any other stored key leaves the profile untouched. It writes
    // no audit row of its own: the STORAGE_FILE_DELETED row above is the act.
    await this.avatarOwner.clearAvatarIfCurrent(userId, input.key);

    return { success: true as const };
  }
}
