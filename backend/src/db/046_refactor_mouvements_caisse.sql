-- Migration: Refactor mouvements_caisse for polymorphic reference tracking
-- Enables linking to payments, deposits, expenses, supplier payments

-- ============================================
-- 1. ADD NEW COLUMNS
-- ============================================

ALTER TABLE mouvements_caisse 
  ADD COLUMN IF NOT EXISTS type VARCHAR(20) CHECK (type IN ('encaissement', 'decaissement')),
  ADD COLUMN IF NOT EXISTS categorie VARCHAR(50) CHECK (categorie IN (
    'paiement_client', 'acompte_client', 'apport', 'autre_entree',
    'depense', 'paiement_fournisseur', 'retrait_banque', 'remboursement_client', 'autre_sortie'
  )),
  ADD COLUMN IF NOT EXISTS reference_type VARCHAR(50) CHECK (reference_type IN ('paiement', 'acompte', 'depense', 'paiement_fournisseur', 'avoir', 'apport', 'retrait')),
  ADD COLUMN IF NOT EXISTS reference_id INTEGER,
  ADD COLUMN IF NOT EXISTS libelle VARCHAR(255),
  ADD COLUMN IF NOT EXISTS solde_apres NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- ============================================
-- 2. MIGRATE EXISTING DATA
-- ============================================

-- Map existing type_mouvement to new type/categorie
UPDATE mouvements_caisse 
SET 
  type = CASE 
    WHEN type_mouvement IN ('vente', 'entree_autre') THEN 'encaissement'
    WHEN type_mouvement IN ('remise', 'sortie') THEN 'decaissement'
    ELSE 'encaissement'
  END,
  categorie = CASE 
    WHEN type_mouvement = 'vente' THEN 'paiement_client'
    WHEN type_mouvement = 'remise' THEN 'remboursement_client'
    WHEN type_mouvement = 'sortie' THEN 'autre_sortie'
    WHEN type_mouvement = 'entree_autre' THEN 'autre_entree'
    ELSE 'autre_entree'
  END,
  reference_type = CASE 
    WHEN facture_id IS NOT NULL THEN 'paiement'
    ELSE NULL
  END,
  reference_id = facture_id,
  libelle = COALESCE(description, 'Mouvement caisse #' || id);

-- ============================================
-- 3. UPDATE INDEXES
-- ============================================

DROP INDEX IF EXISTS idx_mouvements_caisse_session;
DROP INDEX IF EXISTS idx_mouvements_caisse_facture;
DROP INDEX IF EXISTS idx_mouvements_caisse_date;

CREATE INDEX IF NOT EXISTS idx_mouvements_session ON mouvements_caisse(session_id);
CREATE INDEX IF NOT EXISTS idx_mouvements_date ON mouvements_caisse(date_mouvement);
CREATE INDEX IF NOT EXISTS idx_mouvements_type ON mouvements_caisse(type);
CREATE INDEX IF NOT EXISTS idx_mouvements_categorie ON mouvements_caisse(categorie);
CREATE INDEX IF NOT EXISTS idx_mouvements_reference ON mouvements_caisse(reference_type, reference_id);

-- Index for session + date (common query pattern)
CREATE INDEX IF NOT EXISTS idx_mouvements_session_date 
  ON mouvements_caisse(session_id, date_mouvement);

-- ============================================
-- 4. TRIGGER FOR UPDATED_AT
-- ============================================

DROP TRIGGER IF EXISTS update_mouvements_caisse_updated_at ON mouvements_caisse;
CREATE TRIGGER update_mouvements_caisse_updated_at 
  BEFORE UPDATE ON mouvements_caisse 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 5. COMMENTS
-- ============================================

COMMENT ON COLUMN mouvements_caisse.type IS 'encaissement (in) or decaissement (out)';
COMMENT ON COLUMN mouvements_caisse.categorie IS 'Business category of the movement';
COMMENT ON COLUMN mouvements_caisse.reference_type IS 'Polymorphic type: paiement, acompte, depense, paiement_fournisseur, avoir, apport, retrait';
COMMENT ON COLUMN mouvements_caisse.reference_id IS 'ID of the source record';
COMMENT ON COLUMN mouvements_caisse.libelle IS 'Display label for the movement';
COMMENT ON COLUMN mouvements_caisse.solde_apres IS 'Running balance after this movement (for real-time display)';
COMMENT ON TABLE mouvements_caisse IS 'Cash movements - APPEND ONLY: never UPDATE/DELETE, create reverse movement for cancellation';

-- ============================================
-- 6. VERIFY
-- ============================================

SELECT 'Refactored mouvements_caisse:' as info;
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'mouvements_caisse' 
ORDER BY ordinal_position;
