-- Migration: Phase 3 Retail Operations
-- 1. Customer credit limits & payment terms
-- 2. Session/token revocation
-- 3. Reorder point automation infrastructure
-- 4. Product image support
-- 5. Line-level discounts

-- ============================================
-- 1. CUSTOMER CREDIT LIMITS & PAYMENT TERMS
-- ============================================

ALTER TABLE clients ADD COLUMN IF NOT EXISTS credit_max NUMERIC(15, 2) DEFAULT 0.00;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS credit_encours NUMERIC(15, 2) DEFAULT 0.00;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS delai_paiement VARCHAR(50) DEFAULT 'immediat';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS date_echeance_defaut INTEGER DEFAULT 0;

-- Add comment
COMMENT ON COLUMN clients.credit_max IS 'Limite de crédit autorisée (0 = pas de crédit)';
COMMENT ON COLUMN clients.credit_encours IS 'Encours actuel du client';
COMMENT ON COLUMN clients.delai_paiement IS 'Conditions de paiement: immediat, net_30, net_60, net_90';
COMMENT ON COLUMN clients.date_echeance_defaut IS 'Jours avant échéance si délai personnalisé';

-- ============================================
-- 2. SESSION/TOKEN REVOCATION
-- ============================================

-- Add session tracking table
CREATE TABLE IF NOT EXISTS user_sessions (
  id SERIAL PRIMARY KEY,
  utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP,
  ip_address VARCHAR(45),
  user_agent TEXT,
  is_active BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(utilisateur_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(utilisateur_id, is_active) WHERE is_active = true;

COMMENT ON TABLE user_sessions IS 'Session tracking for token revocation';

-- ============================================
-- 3. REORDER POINT AUTOMATION
-- ============================================

-- Add reorder suggestion table
CREATE TABLE IF NOT EXISTS reorder_suggestions (
  id SERIAL PRIMARY KEY,
  produit_id INTEGER NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
  fournisseur_id INTEGER REFERENCES fournisseurs(id) ON DELETE SET NULL,
  quantite_recommandee INTEGER NOT NULL,
  stock_actuel INTEGER NOT NULL,
  stock_min INTEGER NOT NULL,
  vente_moyenne_journaliere NUMERIC(10, 2),
  delai_livraison_moyen INTEGER,
  priorite VARCHAR(20) DEFAULT 'normal' CHECK (priorite IN ('urgent', 'normal', 'low')),
  statut VARCHAR(20) DEFAULT 'pending' CHECK (statut IN ('pending', 'commande Creee', 'ignoree')),
  commande_id INTEGER REFERENCES commandes_fournisseur(id) ON DELETE SET NULL,
  date_suggestion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  date_traitement TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reorder_suggestions_statut ON reorder_suggestions(statut);
CREATE INDEX IF NOT EXISTS idx_reorder_suggestions_priorite ON reorder_suggestions(priorite);
CREATE INDEX IF NOT EXISTS idx_reorder_suggestions_date ON reorder_suggestions(date_suggestion);

COMMENT ON TABLE reorder_suggestions IS 'Automated reorder point suggestions';

-- ============================================
-- 4. PRODUCT IMAGE SUPPORT
-- ============================================

ALTER TABLE produits ADD COLUMN IF NOT EXISTS image_url VARCHAR(500);
ALTER TABLE produits ADD COLUMN IF NOT EXISTS image_thumbnail VARCHAR(500);

CREATE INDEX IF NOT EXISTS idx_produits_image ON produits(image_url) WHERE image_url IS NOT NULL;

COMMENT ON COLUMN produits.image_url IS 'URL to product image (S3 or local storage)';
COMMENT ON COLUMN produits.image_thumbnail IS 'URL to thumbnail version';

-- ============================================
-- 5. LINE-LEVEL DISCOUNTS
-- ============================================

ALTER TABLE facture_lignes ADD COLUMN IF NOT EXISTS remise_pct NUMERIC(5, 2) DEFAULT 0.00;
ALTER TABLE facture_lignes ADD COLUMN IF NOT EXISTS remise_montant NUMERIC(15, 2) DEFAULT 0.00;

COMMENT ON COLUMN facture_lignes.remise_pct IS 'Remise en pourcentage sur la ligne';
COMMENT ON COLUMN facture_lignes.remise_montant IS 'Remise en montant sur la ligne';

-- ============================================
-- 6. UPDATE EXISTING RECORDS
-- ============================================

-- Set default payment term for existing clients
UPDATE clients SET delai_paiement = 'immediat' WHERE delai_paiement IS NULL;
UPDATE clients SET credit_max = 0 WHERE credit_max IS NULL;
UPDATE clients SET credit_encours = 0 WHERE credit_encours IS NULL;
