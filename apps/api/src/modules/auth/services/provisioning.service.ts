import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { User } from '@repo/database' with { 'resolution-mode': 'import' };
import { ROLES } from '@repo/shared/permissions';
import { TokenService } from './token.service';
import { PrismaService } from '../../../common/database/prisma.service';

export interface IProvisionedOrganization {
  user: User;
  rawVerificationToken: string;
}

/**
 * Provisions a brand-new organization (Tenant) and its owner.
 *
 * Self-signup is the only way a Tenant is created today; RegisterService calls
 * this one home for the transaction.
 *
 * The tenant-scope Prisma extension does not guard `Tenant`, `User` or `Token`
 * (they are absent from TENANT_SCOPED_MODELS), so these
 * writes run pre-auth, before any request-scoped tenant exists, and pass
 * through the extension untouched.
 *
 * The owner is always the organization ADMIN, and is now recorded as such:
 * `Tenant.ownerId` points at the user this transaction created. Before that
 * column existed, a promoted ADMIN and the person the organization was provisioned
 * around were indistinguishable to every check in the codebase.
 * Admin rights come from `role` alone, so a later downgrade to USER takes full
 * effect.
 */
@Injectable()
export class ProvisioningService {
  constructor(
    private readonly tokenService: TokenService,
    private readonly prismaService: PrismaService,
  ) {}

  /**
   * Provision the organization (Tenant) + owner (ADMIN) + verification token atomically.
   * Callers wrap this to map a P2002 unique-constraint violation, so the mapping
   * covers only the DB transaction.
   */
  async provisionOrganizationForPasswordSignup(args: {
    normalizedEmail: string;
    passwordHash: string;
    displayName: string | null;
  }): Promise<IProvisionedOrganization> {
    const { normalizedEmail, passwordHash, displayName } = args;
    return this.prismaService.client.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: this.organizationSeed(normalizedEmail) });

      // No emailVerified here: password signup must prove the mailbox first
      // (schema default false), and the token minted below carries that proof.
      const createdUser = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          displayName,
          role: ROLES.ADMIN,
          tenantId: tenant.id,
        },
      });

      // Stamp the owner. It cannot ride the tenant create above, because the
      // user it points at does not exist yet, and it must not be left to a
      // later write: an unowned organization is exactly the state the owner guards
      // treat as "the owner rule does not apply", so a crash between the two
      // statements would silently produce an organization nobody owns.
      await tx.tenant.update({
        where: { id: tenant.id },
        // The relation form rather than a bare `ownerId`: Prisma's checked
        // update input exposes `owner`, and connecting says what this is doing.
        data: { owner: { connect: { id: createdUser.id } } },
      });

      // Mint the verification token via the one shared TokenService path
      // (delete-existing + hash + TTL), on THIS tx so it commits with the user.
      const rawToken = await this.tokenService.createVerificationToken(createdUser.id, tx);

      return { user: createdUser, rawVerificationToken: rawToken };
    });
  }

  /**
   * The shared Tenant payload. Derive the slug from the email local-part plus
   * a random suffix so a second signup with the same local-part (e.g.
   * admin@a.com / admin@b.com) can't collide on the @unique slug. Pure on
   * purpose: the writes stay inline in each transaction callback so the
   * multi-write-transaction lint can SEE they are transactional.
   */
  private organizationSeed(normalizedEmail: string): { name: string; slug: string } {
    const localPart = normalizedEmail.split('@')[0] ?? 'organization';
    const slugBase =
      localPart.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'organization';
    return { name: localPart, slug: `${slugBase}-${randomBytes(4).toString('hex')}` };
  }
}
