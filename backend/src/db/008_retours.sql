-- Migration: Customer Returns (Retours clients)

CREATE TABLE IF NOT EXISTS retours (
  id SERIAL PRIMARY KEY,
  numero_retour VARCHAR(50) UNIQUE NOT NULL,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  date_retour TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  total_remboursement NUMERIC(15, 2) DEFAULT 0.00,
  statut VARCHAR(20) DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'traite', 'annule')),
  notes TEXT,
  cree_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS retour_lignes (
  id SERIAL PRIMARY KEY,
  retour_id INTEGER NOT NULL REFERENCES retours(id) ON DELETE CASCADE,
  facture_id INTEGER NOT NULL REFERENCES factures(id) ON DELETE RESTRICT,
  produit_id INTEGER NOT NULL REFERENCES produits(id) ON DELETE RESTRICT,
  quantite INTEGER NOT NULL DEFAULT 1,
  raison VARCHAR(500) NOT NULL,
  prix_unitaire NUMERIC(15, 2) NOT NULL,
  total_ligne NUMERIC(15, 2) NOT NULL,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_retours_client ON retours(client_id);
CREATE INDEX IF NOT EXISTS idx_retours_date ON retours(date_retour);
CREATE INDEX IF NOT EXISTS idx_retours_statut ON retours(statut);
CREATE INDEX IF NOT EXISTS idx_retour_lignes_retour ON retour_lignes(retour_id);
