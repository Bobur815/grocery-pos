-- Manager-override password for a store's terminals, bcrypt hashed.
-- Nullable and unset by default, so every existing store keeps behaving exactly as it does today
-- until a super admin chooses to configure one.
ALTER TABLE "stores" ADD COLUMN "super_admin_password" TEXT;
