import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { StorageRouter } from './storage.router';
import { SessionModule } from '../auth/session.module';
import { AuthMiddlewareModule } from '../auth/auth-middleware.module';
import { AvatarOwnerModule } from '../user/avatar-owner.module';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';

/**
 * AvatarOwnerModule supplies AvatarOwnerPort, which StorageRouter.deleteFile
 * uses to clear a User.avatarUrl that would otherwise dangle on a deleted S3
 * key. Storage owns the port; the user module binds it. The binding comes
 * from that leaf rather than from UserModule because UserModule already
 * imports StorageModule (UserService needs StorageService for avatar
 * cleanup), so importing it back would create a module cycle.
 *
 * IdempotencyModule provides the IdempotencyMiddleware that StorageRouter
 * wires method-level after auth on its mutations.
 */
@Module({
  imports: [SessionModule, AuthMiddlewareModule, IdempotencyModule, AvatarOwnerModule],
  providers: [StorageService, StorageRouter],
  exports: [StorageService],
})
export class StorageModule {}
