import { Module } from '@nestjs/common';
import { CsrfController } from './csrf.controller';
import { CsrfService } from './csrf.service';
import { EncryptionService } from './encryption.service';

/**
 * Provides CsrfService and EncryptionService, plus the CsrfController that
 * serves GET /api/csrf-token behind the global ThrottlerGuard. Imported
 * explicitly by AppModule (for the bootstrap `app.get(CsrfService)` middleware
 * chain in main.ts) and by AuthModule (for the per-flow services that rotate
 * the CSRF token after login/register/password-change). EncryptionService is
 * the generic reversible-secret primitive (AES-256-GCM); any module that must
 * store a decryptable secret imports SecurityModule and injects it.
 *
 * Not `@Global()`: the consumer set is small enough that explicit imports
 * keep the module graph readable and avoid masking missing-import bugs.
 */
@Module({
  controllers: [CsrfController],
  providers: [CsrfService, EncryptionService],
  exports: [CsrfService, EncryptionService],
})
export class SecurityModule {}
