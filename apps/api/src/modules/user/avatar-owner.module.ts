import { Module } from '@nestjs/common';
import { AvatarOwnerPort } from '../storage/avatar-owner.port';
import { UserRepository } from './user.repository';

/**
 * Binds storage's AvatarOwnerPort to the user row, as a leaf.
 *
 * StorageModule needs the binding and cannot import UserModule for it:
 * UserModule imports StorageModule (UserService deletes the old avatar object
 * through StorageService), so the import back would cycle. This module imports
 * nothing, because UserRepository depends only on the @Global PrismaService, so
 * StorageModule can import it without reopening that loop. The same shape as
 * SessionModule and AuthMiddlewareModule.
 *
 * Only the PORT is exported. The repository instance here is module-local and
 * stateless; exporting it would hand storage every user query again, which is
 * exactly what the port exists to take away.
 */
@Module({
  providers: [UserRepository, { provide: AvatarOwnerPort, useExisting: UserRepository }],
  exports: [AvatarOwnerPort],
})
export class AvatarOwnerModule {}
