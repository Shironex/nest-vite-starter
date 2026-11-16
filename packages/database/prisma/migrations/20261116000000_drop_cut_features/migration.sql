-- Drops the tables and columns of the features cut from the starter:
-- notifications, OAuth accounts, the permission tables, the organization
-- two-factor policy, guided tours, staff invitations and avatar uploads.

-- Open staff invitations cannot survive the enum change below.
DELETE FROM "Token" WHERE "type" = 'STAFF_INVITE';

-- AlterEnum
BEGIN;
CREATE TYPE "TokenType_new" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');
ALTER TABLE "Token" ALTER COLUMN "type" TYPE "TokenType_new" USING ("type"::text::"TokenType_new");
ALTER TYPE "TokenType" RENAME TO "TokenType_old";
ALTER TYPE "TokenType_new" RENAME TO "TokenType";
DROP TYPE "TokenType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "Token" DROP CONSTRAINT "Token_staffInviteTenantId_fkey";

-- DropForeignKey
ALTER TABLE "OAuthAccount" DROP CONSTRAINT "OAuthAccount_userId_fkey";

-- DropForeignKey
ALTER TABLE "RolePermission" DROP CONSTRAINT "RolePermission_permissionId_fkey";

-- DropForeignKey
ALTER TABLE "RolePermission" DROP CONSTRAINT "RolePermission_userId_fkey";

-- DropForeignKey
ALTER TABLE "TwoFactorPolicy" DROP CONSTRAINT "TwoFactorPolicy_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "TourProgress" DROP CONSTRAINT "TourProgress_userId_fkey";

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_userId_fkey";

-- DropForeignKey
ALTER TABLE "NotificationPreference" DROP CONSTRAINT "NotificationPreference_userId_fkey";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "avatarUrl";

-- AlterTable
ALTER TABLE "Token" DROP COLUMN "staffInviteRole",
DROP COLUMN "staffInviteTenantId";

-- DropTable
DROP TABLE "OAuthAccount";

-- DropTable
DROP TABLE "Permission";

-- DropTable
DROP TABLE "RolePermission";

-- DropTable
DROP TABLE "TwoFactorPolicy";

-- DropTable
DROP TABLE "TourProgress";

-- DropTable
DROP TABLE "Notification";

-- DropTable
DROP TABLE "NotificationPreference";

