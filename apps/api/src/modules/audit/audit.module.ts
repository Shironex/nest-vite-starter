import { Global, Module } from '@nestjs/common';
import { AuthMiddlewareModule } from '../auth/auth-middleware.module';
import { AuditService } from './audit.service';
import { AuditPiiScrubService } from './audit-pii-scrub.service';
import { AuditRetentionService } from './audit-retention.service';
import { AuditReadRepository } from './audit-read.repository';
import { AuditReadService } from './audit-read.service';
import { AuditRouter } from './audit.router';

/**
 * AuthMiddlewareModule (not AuthModule) supplies the tRPC middlewares the
 * read router wires, keeping the module free of the AuthModule dependency
 * cycle the middleware module exists to break.
 */
@Global()
@Module({
  imports: [AuthMiddlewareModule],
  providers: [
    AuditService,
    AuditPiiScrubService,
    AuditRetentionService,
    AuditReadRepository,
    AuditReadService,
    AuditRouter,
  ],
  exports: [AuditService, AuditPiiScrubService],
})
export class AuditModule {}
