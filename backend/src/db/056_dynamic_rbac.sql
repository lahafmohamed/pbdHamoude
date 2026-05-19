-- Migration: Dynamic Role-Based Access Control
-- Purpose: Move from fixed ENUM to dynamic tables for roles and permissions

BEGIN;

-- 1. Create permissions table
CREATE TABLE IF NOT EXISTS permissions (
    id SERIAL PRIMARY KEY,
    code VARCHAR(100) UNIQUE NOT NULL,
    nom VARCHAR(255) NOT NULL,
    description TEXT,
    module VARCHAR(50) NOT NULL
);

-- 2. Create roles table
CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    nom VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    is_system BOOLEAN DEFAULT false
);

-- 3. Create role_permissions junction table
CREATE TABLE IF NOT EXISTS role_permissions (
    role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INTEGER REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- 4. Seed basic roles
INSERT INTO roles (nom, description, is_system) VALUES
('admin', 'Administrateur système (Accès total)', true),
('manager', 'Manager magasin', true),
('caissier', 'Caissier standard', true),
('depot_staff', 'Personnel de dépôt', true),
('magasin_staff', 'Personnel de magasin', true),
('viewer', 'Lecteur seul', true)
ON CONFLICT (nom) DO NOTHING;

-- 5. Seed basic permissions
INSERT INTO permissions (code, nom, description, module) VALUES
('users.manage', 'Gérer les utilisateurs', 'Créer, modifier, et supprimer des utilisateurs', 'Admin'),
('roles.manage', 'Gérer les rôles', 'Créer, modifier des rôles et permissions', 'Admin'),
('inventory.read', 'Voir l''inventaire', 'Consulter le stock', 'Inventaire'),
('inventory.write', 'Modifier l''inventaire', 'Ajuster le stock manuellement', 'Inventaire'),
('sales.create', 'Créer des ventes', 'Créer des factures et tickets', 'Ventes'),
('sales.read', 'Voir les ventes', 'Consulter l''historique des ventes', 'Ventes'),
('purchases.create', 'Créer des achats', 'Créer des commandes et réceptions', 'Achats'),
('purchases.read', 'Voir les achats', 'Consulter l''historique des achats', 'Achats')
ON CONFLICT (code) DO NOTHING;

-- 6. Map permissions to Admin role (id=1 assuming standard insert order)
DO $$ 
DECLARE
    v_admin_role_id INTEGER;
BEGIN
    SELECT id INTO v_admin_role_id FROM roles WHERE nom = 'admin';
    IF v_admin_role_id IS NOT NULL THEN
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT v_admin_role_id, id FROM permissions
        ON CONFLICT DO NOTHING;
    END IF;
END $$;

-- 7. Modify utilisateurs table
-- First, add the role_id column
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES roles(id);

-- Update role_id based on existing role string
UPDATE utilisateurs u 
SET role_id = r.id 
FROM roles r 
WHERE u.role::text = r.nom;

-- Set a default for nulls just in case, default to viewer or something, but shouldn't happen
UPDATE utilisateurs SET role_id = (SELECT id FROM roles WHERE nom = 'viewer') WHERE role_id IS NULL;

-- Make role_id NOT NULL
ALTER TABLE utilisateurs ALTER COLUMN role_id SET NOT NULL;

-- Drop the old role column and the enum type
ALTER TABLE utilisateurs DROP COLUMN role;
DROP TYPE IF EXISTS user_role;

-- Rename role_id to role for backward compatibility, OR keep role_id and create a view.
-- To avoid breaking everything, we will keep role_id, but many queries use `u.role`.
-- Let's add a generated column or just keep role_id and rename it?
-- Actually, let's rename role_id to role, but change its type.
-- Wait, if we name it role_id, existing code that SELECTs * and expects `user.role` to be a string will break.
-- So we need to update the backend models/queries.
-- Actually, a safer way to avoid breaking `SELECT *` right now is to keep the `role` column as a string, but make it a generated column, OR just update the backend to JOIN roles.
-- Let's update the backend queries instead.
-- Wait, we can't change `u.role` without touching EVERY query that uses it.
-- Let's keep `role_id` and add a view, OR just update `auth.ts` to join the role name.
-- Since we are refactoring, we will update the backend `auth.ts` to join `roles.nom AS role`.

COMMIT;
