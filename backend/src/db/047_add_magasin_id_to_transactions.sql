-- Migration: Add magasin_id to all cash transaction tables
-- Required for cash register linkage and location-based reporting

-- ============================================
-- 1. PAIEMENTS
-- ============================================

ALTER TABLE paiements 
  ADD COLUMN IF NOT EXISTS magasin_id INTEGER REFERENCES magasins(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_paiements_magasin ON paiements(magasin_id);

-- Backfill: assign magasin_id from facture's location
UPDATE paiements p
SET magasin_id = m.id
FROM factures f
JOIN stock_locations sl ON f.location_id = sl.id
JOIN magasins m ON m.location_id = sl.id
WHERE p.facture_id = f.id 
  AND p.magasin_id IS NULL
  AND sl.location_type = 'magasin';

-- For remaining unassigned, assign to default magasin
UPDATE paiements 
SET magasin_id = (SELECT id FROM magasins ORDER BY id LIMIT 1)
WHERE magasin_id IS NULL;

COMMENT ON COLUMN paiements.magasin_id IS 'Store where this payment was received - required for cash transactions';

-- ============================================
-- 2. ACOMPTES_CLIENTS
-- ============================================

ALTER TABLE acomptes_clients 
  ADD COLUMN IF NOT EXISTS magasin_id INTEGER REFERENCES magasins(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_acomptes_magasin ON acomptes_clients(magasin_id);

-- Backfill: assign to default magasin
UPDATE acomptes_clients 
SET magasin_id = (SELECT id FROM magasins ORDER BY id LIMIT 1)
WHERE magasin_id IS NULL;

COMMENT ON COLUMN acomptes_clients.magasin_id IS 'Store where this advance was received - required for cash transactions';

-- ============================================
-- 3. DEPENSES
-- ============================================

ALTER TABLE depenses 
  ADD COLUMN IF NOT EXISTS magasin_id INTEGER REFERENCES magasins(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS mouvement_caisse_id INTEGER REFERENCES mouvements_caisse(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS beneficiaire_libre VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_depenses_magasin ON depenses(magasin_id);
CREATE INDEX IF NOT EXISTS idx_depenses_mouvement ON depenses(mouvement_caisse_id);

-- Migrate: set magasin_id from location_id
UPDATE depenses d
SET magasin_id = m.id
FROM stock_locations sl
JOIN magasins m ON m.location_id = sl.id
WHERE d.location_id = sl.id 
  AND d.magasin_id IS NULL
  AND sl.location_type = 'magasin';

-- For remaining, assign to default magasin
UPDATE depenses 
SET magasin_id = (SELECT id FROM magasins ORDER BY id LIMIT 1)
WHERE magasin_id IS NULL;

-- Copy fournisseur/tiers info to beneficiaire_libre if no linked tier
UPDATE depenses d
SET beneficiaire_libre = t.raison_sociale
FROM tiers t
WHERE d.tiers_id = t.id 
  AND d.beneficiaire_libre IS NULL;

COMMENT ON COLUMN depenses.magasin_id IS 'Store where this expense occurred - required, replaces location_id for cash operations';
COMMENT ON COLUMN depenses.mouvement_caisse_id IS 'Link to cash movement - auto-filled for cash payments';
COMMENT ON COLUMN depenses.beneficiaire_libre IS 'Free-text beneficiary when no supplier linked';

-- ============================================
-- 4. PAIEMENTS_FOURNISSEUR
-- ============================================

ALTER TABLE paiements_fournisseur 
  ADD COLUMN IF NOT EXISTS magasin_id INTEGER REFERENCES magasins(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_paiements_fournisseur_magasin ON paiements_fournisseur(magasin_id);

-- Backfill: assign to default magasin (fournisseur payments usually from main location)
UPDATE paiements_fournisseur 
SET magasin_id = (SELECT id FROM magasins ORDER BY id LIMIT 1)
WHERE magasin_id IS NULL;

COMMENT ON COLUMN paiements_fournisseur.magasin_id IS 'Store from which this supplier payment was made - required for cash transactions';

-- ============================================
-- 5. VERIFY
-- ============================================

SELECT 'Added magasin_id to transaction tables:' as info;

SELECT 
  'paiements' as table_name,
  COUNT(*) as total,
  COUNT(magasin_id) as with_magasin
FROM paiements
UNION ALL
SELECT 
  'acomptes_clients',
  COUNT(*),
  COUNT(magasin_id)
FROM acomptes_clients
UNION ALL
SELECT 
  'depenses',
  COUNT(*),
  COUNT(magasin_id)
FROM depenses
UNION ALL
SELECT 
  'paiements_fournisseur',
  COUNT(*),
  COUNT(magasin_id)
FROM paiements_fournisseur;
