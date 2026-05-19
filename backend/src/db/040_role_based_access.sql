-- Migration: Role-Based Access Control for Depot/Magasin Separation
-- Purpose: Extend role system for strict stock location separation

-- ============================================
-- 1. EXTEND ROLE ENUM (PostgreSQL compatible approach)
-- ============================================

-- Create new role type with all values
CREATE TYPE user_role_new AS ENUM ('admin', 'manager', 'caissier', 'depot_staff', 'magasin_staff', 'viewer');

-- Alter table to use new type (PostgreSQL requires casting)
ALTER TABLE utilisateurs 
    ALTER COLUMN role TYPE user_role_new 
    USING role::text::user_role_new;

-- Drop old type and rename new one
DROP TYPE IF EXISTS user_role;
ALTER TYPE user_role_new RENAME TO user_role;

-- Add comment
COMMENT ON COLUMN utilisateurs.role IS 'User role: admin=full, manager=legacy, caissier=legacy, depot_staff=depot only, magasin_staff=magasin only, viewer=read-only';

-- ============================================
-- 2. LOCATION TYPE DISCRIMINATOR
-- ============================================

-- Add location_type to stock_locations for clearer identification
ALTER TABLE stock_locations 
    ADD COLUMN IF NOT EXISTS location_type VARCHAR(20) 
    CHECK (location_type IN ('depot', 'magasin'));

-- Backfill: est_principal=true → depot, else magasin
UPDATE stock_locations 
    SET location_type = CASE WHEN est_principal THEN 'depot' ELSE 'magasin' END
    WHERE location_type IS NULL;

-- Make it not null after backfill
ALTER TABLE stock_locations 
    ALTER COLUMN location_type SET NOT NULL;

-- Add comment
COMMENT ON COLUMN stock_locations.location_type IS 'Discriminator: depot (principal) or magasin (retail)';

-- ============================================
-- 3. USER-LOCATION ROLE ASSIGNMENTS (New canonical table)
-- ============================================

-- This table supersedes utilisateur_locations with explicit role context
CREATE TABLE IF NOT EXISTS user_location_roles (
    id SERIAL PRIMARY KEY,
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    location_id INTEGER NOT NULL REFERENCES stock_locations(id) ON DELETE CASCADE,
    role_at_location VARCHAR(20) NOT NULL CHECK (role_at_location IN ('depot_staff', 'magasin_staff', 'both')),
    est_defaut BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(utilisateur_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_user_location_roles_user ON user_location_roles(utilisateur_id);
CREATE INDEX IF NOT EXISTS idx_user_location_roles_location ON user_location_roles(location_id);

COMMENT ON TABLE user_location_roles IS 'Canonical user-location assignments with explicit role context';

-- ============================================
-- 4. MIGRATE EXISTING utilisateur_locations DATA
-- ============================================

-- Migrate existing mappings with inferred role based on location type
INSERT INTO user_location_roles (utilisateur_id, location_id, role_at_location, est_defaut)
SELECT 
    ul.utilisateur_id,
    ul.location_id,
    CASE 
        WHEN sl.location_type = 'depot' THEN 'depot_staff'
        WHEN sl.location_type = 'magasin' THEN 'magasin_staff'
        ELSE 'both'
    END,
    ul.est_defaut
FROM utilisateur_locations ul
JOIN stock_locations sl ON ul.location_id = sl.id
ON CONFLICT (utilisateur_id, location_id) DO NOTHING;

-- ============================================
-- 5. SEED NEW ROLE USERS (Placeholder - admin should replace with real names)
-- ============================================

-- Two depot staff (password: depot123)
INSERT INTO utilisateurs (username, email, password_hash, nom_complet, role, actif)
VALUES 
    ('depot1', 'depot1@magasin.local', '$2b$10$7YlOj7uJ6Xj7KqKqKqKqKqO8XlOj7uJ6Xj7KqKqKqKqKqO8XlOj7uJ6', 'Employé Dépôt 1', 'depot_staff', true),
    ('depot2', 'depot2@magasin.local', '$2b$10$7YlOj7uJ6Xj7KqKqKqKqKqO8XlOj7uJ6Xj7KqKqKqKqKqO8XlOj7uJ6', 'Employé Dépôt 2', 'depot_staff', true)
ON CONFLICT (username) DO UPDATE SET 
    role = 'depot_staff',
    actif = true,
    password_hash = EXCLUDED.password_hash;

-- Two magasin staff (password: magasin123)
INSERT INTO utilisateurs (username, email, password_hash, nom_complet, role, actif)
VALUES 
    ('magasin1', 'magasin1@magasin.local', '$2b$10$8XmPk8vK7YkLrLrLrLrLrP9YmPk8vK7YkLrLrLrLrLrP9YmPk8vK7', 'Employé Magasin 1', 'magasin_staff', true),
    ('magasin2', 'magasin2@magasin.local', '$2b$10$8XmPk8vK7YkLrLrLrLrLrP9YmPk8vK7YkLrLrLrLrLrP9YmPk8vK7', 'Employé Magasin 2', 'magasin_staff', true)
ON CONFLICT (username) DO UPDATE SET 
    role = 'magasin_staff',
    actif = true,
    password_hash = EXCLUDED.password_hash;

-- Update legacy users to appropriate roles based on existing assignments
UPDATE utilisateurs u
SET role = 'depot_staff'
WHERE u.role = 'manager' AND EXISTS (
    SELECT 1 FROM utilisateur_locations ul 
    JOIN stock_locations sl ON ul.location_id = sl.id
    WHERE ul.utilisateur_id = u.id AND sl.est_principal = true
);

UPDATE utilisateurs u
SET role = 'magasin_staff'
WHERE u.role = 'caissier' AND EXISTS (
    SELECT 1 FROM utilisateur_locations ul 
    JOIN stock_locations sl ON ul.location_id = sl.id
    WHERE ul.utilisateur_id = u.id AND sl.est_principal = false
);

-- ============================================
-- 6. SEED LOCATION ASSIGNMENTS FOR NEW USERS
-- ============================================

-- Get depot and magasin IDs
DO $$
DECLARE
    depot_id INTEGER;
    magasin_id INTEGER;
    depot1_id INTEGER;
    depot2_id INTEGER;
    magasin1_id INTEGER;
    magasin2_id INTEGER;
BEGIN
    -- Get location IDs
    SELECT id INTO depot_id FROM stock_locations WHERE location_type = 'depot' LIMIT 1;
    SELECT id INTO magasin_id FROM stock_locations WHERE location_type = 'magasin' LIMIT 1;
    
    -- Get user IDs
    SELECT id INTO depot1_id FROM utilisateurs WHERE username = 'depot1';
    SELECT id INTO depot2_id FROM utilisateurs WHERE username = 'depot2';
    SELECT id INTO magasin1_id FROM utilisateurs WHERE username = 'magasin1';
    SELECT id INTO magasin2_id FROM utilisateurs WHERE username = 'magasin2';
    
    -- Assign depot staff to depot (default)
    IF depot_id IS NOT NULL THEN
        INSERT INTO user_location_roles (utilisateur_id, location_id, role_at_location, est_defaut)
        VALUES 
            (depot1_id, depot_id, 'depot_staff', true),
            (depot2_id, depot_id, 'depot_staff', true)
        ON CONFLICT (utilisateur_id, location_id) DO UPDATE SET est_defaut = true;
    END IF;
    
    -- Assign magasin staff to magasin (default)
    IF magasin_id IS NOT NULL THEN
        INSERT INTO user_location_roles (utilisateur_id, location_id, role_at_location, est_defaut)
        VALUES 
            (magasin1_id, magasin_id, 'magasin_staff', true),
            (magasin2_id, magasin_id, 'magasin_staff', true)
        ON CONFLICT (utilisateur_id, location_id) DO UPDATE SET est_defaut = true;
    END IF;
END $$;

-- ============================================
-- 7. CREATE HELPER FUNCTIONS
-- ============================================

-- Function to check if user has specific role at location
CREATE OR REPLACE FUNCTION get_user_location_role(p_user_id INTEGER, p_location_id INTEGER)
RETURNS VARCHAR(20) AS $$
DECLARE
    v_role VARCHAR(20);
    v_global_role VARCHAR(20);
BEGIN
    -- Get global role first
    SELECT role INTO v_global_role FROM utilisateurs WHERE id = p_user_id;
    
    -- Admin has all roles everywhere
    IF v_global_role = 'admin' THEN
        RETURN 'admin';
    END IF;
    
    -- Check specific assignment
    SELECT role_at_location INTO v_role
    FROM user_location_roles
    WHERE utilisateur_id = p_user_id AND location_id = p_location_id;
    
    -- Fallback to global role interpretation
    IF v_role IS NULL THEN
        IF v_global_role = 'depot_staff' THEN
            -- Check if this location is a depot
            SELECT CASE WHEN location_type = 'depot' THEN 'depot_staff' ELSE NULL END
            INTO v_role
            FROM stock_locations WHERE id = p_location_id;
        ELSIF v_global_role = 'magasin_staff' THEN
            -- Check if this location is a magasin
            SELECT CASE WHEN location_type = 'magasin' THEN 'magasin_staff' ELSE NULL END
            INTO v_role
            FROM stock_locations WHERE id = p_location_id;
        END IF;
    END IF;
    
    RETURN COALESCE(v_role, 'none');
END;
$$ LANGUAGE plpgsql;

-- Function to get default location for user
CREATE OR REPLACE FUNCTION get_user_default_location_id(p_user_id INTEGER)
RETURNS INTEGER AS $$
DECLARE
    v_location_id INTEGER;
BEGIN
    SELECT location_id INTO v_location_id
    FROM user_location_roles
    WHERE utilisateur_id = p_user_id AND est_defaut = true
    LIMIT 1;
    
    -- Fallback to any assigned location
    IF v_location_id IS NULL THEN
        SELECT location_id INTO v_location_id
        FROM user_location_roles
        WHERE utilisateur_id = p_user_id
        LIMIT 1;
    END IF;
    
    RETURN v_location_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_user_location_role IS 'Returns the effective role of a user at a specific location';
COMMENT ON FUNCTION get_user_default_location_id IS 'Returns the default working location for a user';
