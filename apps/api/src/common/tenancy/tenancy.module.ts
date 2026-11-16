import { Module } from '@nestjs/common';
import { CrossTenantIterator } from './cross-tenant-iterator';

/**
 * Provides the CrossTenantIterator to the feature modules whose scheduled
 * sweeps need the tenant list before they can re-enter a tenant scope.
 *
 * Not `@Global()`: the whole point of the iterator is that reaching for it is
 * a visible decision, so the import line stays where a reviewer sees it.
 * PrismaModule is already `@Global()`, so this module needs no imports.
 */
@Module({
  providers: [CrossTenantIterator],
  exports: [CrossTenantIterator],
})
export class TenancyModule {}
