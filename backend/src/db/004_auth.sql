-- Migration: Authentication & Audit Infrastructure

-- ============================================
-- 1. Users Table
-- ============================================
CREATE TABLE IF NOT EXISTS utilisateurs (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  nom_complet VARCHAR(255),
  role VARCHAR(20) NOT NULL DEFAULT 'caissier' CHECK (role IN ('admin', 'manager', 'caissier')),
  actif BOOLEAN NOT NULL DEFAULT true,
  dernier_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_utilisateurs_updated_at ON utilisateurs;
CREATE TRIGGER update_utilisateurs_updated_at BEFORE UPDATE ON utilisateurs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_utilisateurs_username ON utilisateurs(username);
CREATE INDEX IF NOT EXISTS idx_utilisateurs_email ON utilisateurs(email);

-- ============================================
-- 2. Audit Log Table
-- ============================================
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  utilisateur_id INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  action VARCHAR(50) NOT NULL CHECK (action IN ('create', 'update', 'delete', 'login', 'logout')),
  table_name VARCHAR(100) NOT NULL,
  record_id INTEGER,
  old_values JSONB,
  new_values JSONB,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(utilisateur_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_table ON audit_log(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_log(created_at);

-- ============================================
-- 3. Sessions Table (for token management)
-- ============================================
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(utilisateur_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ============================================
-- 4. Add audit columns to existing tables
-- ============================================
DO $$ BEGIN
  -- Add created_by / updated_by columns
  ALTER TABLE produits ADD COLUMN IF NOT EXISTS cree_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL;
  ALTER TABLE produits ADD COLUMN IF NOT EXISTS modifie_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS cree_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS modifie_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL;
  ALTER TABLE factures ADD COLUMN IF NOT EXISTS cree_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL;
  ALTER TABLE factures ADD COLUMN IF NOT EXISTS modifie_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL;
  ALTER TABLE fournisseurs ADD COLUMN IF NOT EXISTS cree_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL;
  ALTER TABLE fournisseurs ADD COLUMN IF NOT EXISTS modifie_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL;
  ALTER TABLE commandes_fournisseur ADD COLUMN IF NOT EXISTS cree_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL;
  ALTER TABLE commandes_fournisseur ADD COLUMN IF NOT EXISTS modifie_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL;
  ALTER TABLE paiements ADD COLUMN IF NOT EXISTS modifie_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL;
END $$;

-- ============================================
-- 5. Insert default admin user
-- Password: admin123 (change after first login!)
-- ============================================
INSERT INTO utilisateurs (username, email, password_hash, nom_complet, role, actif)
VALUES (
  'admin',
  'admin@magasin.local',
  '$2b$10$7jJUuvtd5g7fmrHQfT2nLe.fjsTI03L5keMq2H6W.V52wiQP0GgGe',
  'Administrateur Systeme',
  'admin',
  true
) ON CONFLICT (username) DO NOTHING;

-- ============================================
-- 6. Create a manager user for testing
-- Password: manager123
-- ============================================
INSERT INTO utilisateurs (username, email, password_hash, nom_complet, role, actif)
VALUES (
  'manager',
  'manager@magasin.local',
  '$2b$10$bt6wLKMxRX0zOwd.Tw8jMe0FjgPGIBqCFW9OgHXEwKy58su2iAnfy',
  'Manager Magasin',
  'manager',
  true
) ON CONFLICT (username) DO NOTHING;

-- ============================================
-- 7. Create a cashier user for testing
-- Password: caissier123
-- ============================================
INSERT INTO utilisateurs (username, email, password_hash, nom_complet, role, actif)
VALUES (
  'caissier',
  'caissier@magasin.local',
  '$2b$10$8uqXEqWNfkrUq.EJVGsNH.X9JPgvt9Urm6miJRhARYFo.r6esjDqW',
  'Caissier Magasin',
  'caissier',
  true
) ON CONFLICT (username) DO NOTHING;
