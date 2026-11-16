import { Module } from '@nestjs/common';
import { DataExportService } from './data-export.service';
import { DataExportRouter } from './data-export.router';
import { SessionModule } from '../auth/session.module';
import { AuthMiddlewareModule } from '../auth/auth-middleware.module';
import { UserModule } from '../user/user.module';

/**
 * DataExportModule imports the cycle-breaker pair (SessionModule +
 * AuthMiddlewareModule) so its router can use `@UseMiddlewares(AuthMiddleware)`
 * without depending on AuthModule, the same pattern as UserModule. UserModule
 * is imported to reuse `UserService.getProfile` for the account section.
 * PrismaService is available globally (PrismaModule is `@Global`).
 */
@Module({
  imports: [SessionModule, AuthMiddlewareModule, UserModule],
  providers: [DataExportService, DataExportRouter],
})
export class DataExportModule {}
