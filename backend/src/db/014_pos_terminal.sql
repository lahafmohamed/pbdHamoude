-- Migration: POS Terminal Support
-- Add barcode scanning support and quick sale tracking

-- Add default customer for walk-in sales
INSERT INTO clients (nom, prenom, email, telephone, adresse, nif)
VALUES ('Client', 'Passager', 'walk-in@magasin.dz', '', 'Client passager', 'N/A')
ON CONFLICT DO NOTHING;

-- Create POS sessions for tracking daily sales
CREATE TABLE IF NOT EXISTS pos_sessions (
  id SERIAL PRIMARY KEY,
  utilisateur_id INTEGER REFERENCES utilisateurs(id) ON DELETE RESTRICT,
  date_ouverture TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_fermeture TIMESTAMP,
  solde_ouverture NUMERIC(15, 2) DEFAULT 0.00,
  total_ventes NUMERIC(15, 2) DEFAULT 0.00,
  nombre_ventes INTEGER DEFAULT 0,
  statut VARCHAR(20) DEFAULT 'ouverte' CHECK (statut IN ('ouverte', 'fermee')),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pos_sessions_utilisateur ON pos_sessions(utilisateur_id);
CREATE INDEX IF NOT EXISTS idx_pos_sessions_statut ON pos_sessions(statut);
CREATE INDEX IF NOT EXISTS idx_pos_sessions_date ON pos_sessions(date_ouverture);

-- Quick sale items cache (for fast POS checkout)
CREATE TABLE IF NOT EXISTS pos_cart_items (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES pos_sessions(id) ON DELETE CASCADE,
  produit_id INTEGER REFERENCES produits(id) ON DELETE RESTRICT,
  quantite INTEGER NOT NULL DEFAULT 1,
  prix_unitaire NUMERIC(15, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pos_cart_session ON pos_cart_items(session_id);
CREATE INDEX IF NOT EXISTS idx_pos_cart_produit ON pos_cart_items(produit_id);

-- Barcode scan history (for analytics)
CREATE TABLE IF NOT EXISTS barcode_scans (
  id SERIAL PRIMARY KEY,
  code_barre VARCHAR(100) NOT NULL,
  produit_id INTEGER REFERENCES produits(id) ON DELETE SET NULL,
  utilisateur_id INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  date_scan TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  succes BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_barcode_scans_code ON barcode_scans(code_barre);
CREATE INDEX IF NOT EXISTS idx_barcode_scans_date ON barcode_scans(date_scan);
CREATE INDEX IF NOT EXISTS idx_barcode_scans_produit ON barcode_scans(produit_id);

COMMENT ON TABLE pos_sessions IS 'POS terminal sessions for walk-in sales';
COMMENT ON TABLE pos_cart_items IS 'Quick cart items for POS checkout';
COMMENT ON TABLE barcode_scans IS 'Barcode scan history for analytics';
