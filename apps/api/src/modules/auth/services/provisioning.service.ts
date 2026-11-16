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
 * Self-signup is the only way a Tenant is created today, so the transaction
 * used to live inline in RegisterService. It is a service of its own because
 * signup has a SECOND entry point (the OAuth callback, which provisions a
 * organization for a first-time Google user without ever going through password
 * registration). Both entry points must mint the identical Tenant + owner-ADMIN
 * shape, and the only way to guarantee that is one home for the transaction.
 *
 * The tenant-scope Prisma extension does not guard `Tenant`, `User`, `Token`
 * or `OAuthAccount` (they are absent from TENANT_SCOPED_MODELS), so these
 * writes run pre-auth, before any request-scoped tenant exists, and pass
 * through the extension untouched.
 *
 * The owner is always the organization ADMIN, and is now recorded as such:
 * `Tenant.ownerId` points at the user this transaction created. Before that
 * column existed, a promoted ADMIN and the person the organization was provisioned
 * around were indistinguishable to every check in the codebase.
 * ADMIN permissions are intentionally NOT
 * granted as per-user RolePermission rows in either path. The global
 * role-level grant (role: ADMIN, userId: null) is seeded once and shared by
 * every ADMIN; the permission middleware reads it via the
 * `{ role, userId: null }` OR-arm, so `role: ADMIN` alone confers the full
 * set. Minting per-user rows instead would SURVIVE a later downgrade to USER -
 * updateRole changes the role and revokes sessions but cannot know which
 * per-user grants to delete - leaving a downgraded owner with live admin
 * powers. Role-derived perms are governed by `role`, so a downgrade takes full
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
   * Provision the organization + owner for a first-time OAuth signup (Google sign-in
   * SPEC section 7): the SAME Tenant + owner-ADMIN shape as the password path,
   * plus the OAuthAccount link row, in ONE transaction. Differences are exactly
   * the ones the spec locks down:
   *
   *   - `passwordHash` is null: the account signs in with the provider only,
   *     and every password-verify site fails closed on the null.
   *   - `emailVerified` is true and NO verification token is minted: the
   *     caller has already enforced the provider's `email_verified` claim
   *    , so a mailbox round-trip would prove nothing new.
   *   - displayName/avatarUrl come from the verified ID-token claims.
   *
   * Callers map P2002 (concurrent signup, or a soft-deleted user still holding
   * the email) exactly like the password path.
   */
  async provisionOrganizationForOAuthSignup(args: {
    normalizedEmail: string;
    displayName: string | null;
    avatarUrl: string | null;
    provider: string;
    providerAccountId: string;
  }): Promise<User> {
    const { normalizedEmail, displayName, avatarUrl, provider, providerAccountId } = args;
    return this.prismaService.client.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: this.organizationSeed(normalizedEmail) });

      const createdUser = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash: null,
          displayName,
          ...(avatarUrl == null ? {} : { avatarUrl }),
          emailVerified: true,
          role: ROLES.ADMIN,
          tenantId: tenant.id,
        },
      });

      // Same stamp as the password path, and for the same reason: both entry
      // points must mint the identical Tenant + owner-ADMIN shape, which is
      // the whole reason this transaction has one home.
      await tx.tenant.update({
        where: { id: tenant.id },
        // The relation form rather than a bare `ownerId`: Prisma's checked
        // update input exposes `owner`, and connecting says what this is doing.
        data: { owner: { connect: { id: createdUser.id } } },
      });

      // The link row commits with the user: a crash between the two would
      // otherwise strand an OAuth-only account no provider can ever reach.
      await tx.oAuthAccount.create({
        data: {
          provider,
          providerAccountId,
          email: normalizedEmail,
          emailVerified: true,
          userId: createdUser.id,
        },
      });

      return createdUser;
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
