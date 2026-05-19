-- Migration: Refactor sessions_caisse from user-centric to magasin-centric
-- BREAKING CHANGE: Alters existing sessions_caisse table structure

-- ============================================
-- 1. ADD NEW COLUMNS
-- ============================================

ALTER TABLE sessions_caisse 
  ADD COLUMN IF NOT EXISTS magasin_id INTEGER REFERENCES magasins(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS ouverte_par_user_id INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cloturee_par_user_id INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fond_initial NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS fond_final_compte NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS solde_theorique_cloture NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS commentaire_ouverture TEXT,
  ADD COLUMN IF NOT EXISTS commentaire_cloture TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Rename existing columns for clarity (PostgreSQL compatible approach)
DO $$
BEGIN
  -- Rename solde_ouverture to fond_initial if fond_initial is null
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'sessions_caisse' AND column_name = 'solde_ouverture') THEN
    -- Copy data if new column is empty
    UPDATE sessions_caisse SET fond_initial = solde_ouverture WHERE fond_initial IS NULL;
  END IF;
  
  -- Rename solde_fermeture to fond_final_compte if empty
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'sessions_caisse' AND column_name = 'solde_fermeture') THEN
    UPDATE sessions_caisse SET fond_final_compte = solde_fermeture WHERE fond_final_compte IS NULL;
  END IF;
  
  -- Rename solde_theorique to solde_theorique_cloture if empty  
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'sessions_caisse' AND column_name = 'solde_theorique') THEN
    UPDATE sessions_caisse SET solde_theorique_cloture = solde_theorique WHERE solde_theorique_cloture IS NULL;
  END IF;
  
  -- Copy utilisateur_id to ouverte_par_user_id
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'sessions_caisse' AND column_name = 'utilisateur_id') THEN
    UPDATE sessions_caisse SET ouverte_par_user_id = utilisateur_id WHERE ouverte_par_user_id IS NULL;
  END IF;

  -- Rename date_fermeture to date_cloture
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'sessions_caisse' AND column_name = 'date_fermeture') THEN
    ALTER TABLE sessions_caisse RENAME COLUMN date_fermeture TO date_cloture;
  END IF;

  -- Rename notes_ouverture to commentaire_ouverture
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'sessions_caisse' AND column_name = 'notes_ouverture') THEN
    ALTER TABLE sessions_caisse RENAME COLUMN notes_ouverture TO commentaire_ouverture;
  END IF;

  -- Rename notes_fermeture to commentaire_cloture
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'sessions_caisse' AND column_name = 'notes_fermeture') THEN
    ALTER TABLE sessions_caisse RENAME COLUMN notes_fermeture TO commentaire_cloture;
  END IF;
END $$;

-- ============================================
-- 2. BACKFILL MAGASIN_ID
-- ============================================

-- Assign existing sessions to the default magasin
UPDATE sessions_caisse 
SET magasin_id = (SELECT id FROM magasins ORDER BY id LIMIT 1)
WHERE magasin_id IS NULL;

-- ============================================
-- 3. ALTER STATUT CHECK CONSTRAINT
-- ============================================

-- Drop existing check constraint if exists
ALTER TABLE sessions_caisse DROP CONSTRAINT IF EXISTS sessions_caisse_statut_check;

-- Add new check constraint
ALTER TABLE sessions_caisse 
  ADD CONSTRAINT sessions_caisse_statut_check 
  CHECK (statut IN ('ouverte', 'cloturee'));

-- ============================================
-- 4. CREATE UNIQUE PARTIAL INDEX
-- ============================================

-- Ensure only one open session per magasin
DROP INDEX IF EXISTS idx_sessions_une_ouverte_par_magasin;
CREATE UNIQUE INDEX idx_sessions_une_ouverte_par_magasin 
  ON sessions_caisse (magasin_id) 
  WHERE statut = 'ouverte';

-- ============================================
-- 5. UPDATE INDEXES
-- ============================================

DROP INDEX IF EXISTS idx_sessions_caisse_utilisateur;
DROP INDEX IF EXISTS idx_sessions_caisse_statut;
DROP INDEX IF EXISTS idx_sessions_caisse_date;

CREATE INDEX IF NOT EXISTS idx_sessions_magasin ON sessions_caisse(magasin_id);
CREATE INDEX IF NOT EXISTS idx_sessions_statut ON sessions_caisse(statut);
CREATE INDEX IF NOT EXISTS idx_sessions_date_ouverture ON sessions_caisse(date_ouverture);
CREATE INDEX IF NOT EXISTS idx_sessions_ouverte_par ON sessions_caisse(ouverte_par_user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_cloturee_par ON sessions_caisse(cloturee_par_user_id);

-- ============================================
-- 6. MAKE CRITICAL COLUMNS NOT NULL
-- ============================================

-- After backfill, make magasin_id NOT NULL
ALTER TABLE sessions_caisse 
  ALTER COLUMN magasin_id SET NOT NULL,
  ALTER COLUMN ouverte_par_user_id SET NOT NULL;

-- ============================================
-- 7. TRIGGER FOR UPDATED_AT
-- ============================================

DROP TRIGGER IF EXISTS update_sessions_caisse_updated_at ON sessions_caisse;
CREATE TRIGGER update_sessions_caisse_updated_at 
  BEFORE UPDATE ON sessions_caisse 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 8. COMMENTS
-- ============================================

COMMENT ON COLUMN sessions_caisse.magasin_id IS 'Store this cash session belongs to - each magasin has one open session max';
COMMENT ON COLUMN sessions_caisse.ouverte_par_user_id IS 'User who opened this session';
COMMENT ON COLUMN sessions_caisse.cloturee_par_user_id IS 'User who closed this session';
COMMENT ON COLUMN sessions_caisse.fond_initial IS 'Physical cash count at opening (FCFA)';
COMMENT ON COLUMN sessions_caisse.fond_final_compte IS 'Physical cash count at closing (FCFA)';
COMMENT ON COLUMN sessions_caisse.solde_theorique_cloture IS 'Calculated: fond_initial + encaissements - decaissements';
COMMENT ON COLUMN sessions_caisse.ecart IS ' fond_final_compte - solde_theorique_cloture';
COMMENT ON COLUMN sessions_caisse.commentaire_cloture IS 'Required if ecart != 0';

-- ============================================
-- 9. VERIFY
-- ============================================

SELECT 'Refactored sessions_caisse:' as info;
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'sessions_caisse' 
ORDER BY ordinal_position;
