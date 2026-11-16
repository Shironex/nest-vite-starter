import { Module } from '@nestjs/common';
import { TwoFactorEnrollmentReader } from './services/two-factor-enrollment.reader';
import { SecondFactorRepository } from './repositories/second-factor.repository';

/**
 * Lightweight home for the shared "is 2FA enrollment still required" re-derivation
 * (TwoFactorEnrollmentReader). Depends only on the global PrismaService, so both
 * the cycle-breaker AuthMiddlewareModule and EventsModule can import it to gate a
 * session against live state without pulling the heavy AuthModule graph or
 * reopening the AuthModule cycle. SecondFactorRepository is provided but not
 * exported: it is an internal dependency of the reader only.
 */
@Module({
  providers: [TwoFactorEnrollmentReader, SecondFactorRepository],
  exports: [TwoFactorEnrollmentReader],
})
export class TwoFactorEnrollmentModule {}
