-- Migration 028: Force password change on first login for seeded users
-- Adds must_change_password flag to utilisateurs table.

ALTER TABLE utilisateurs
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

-- Mark all currently active seeded users (created before this migration) as
-- requiring a password change. Admins must set new passwords after deployment.
UPDATE utilisateurs
  SET must_change_password = true
  WHERE created_at < NOW();
