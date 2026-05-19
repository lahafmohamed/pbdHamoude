-- Migration: Purchase Receipts (Réception de commandes)

-- Table for receipt records
CREATE TABLE IF NOT EXISTS receptions (
  id SERIAL PRIMARY KEY,
  commande_id INTEGER NOT NULL REFERENCES commandes_fournisseur(id) ON DELETE RESTRICT,
  numero_reception VARCHAR(50) UNIQUE NOT NULL,
  date_reception TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  receptionne_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table for receipt line items
CREATE TABLE IF NOT EXISTS reception_lignes (
  id SERIAL PRIMARY KEY,
  reception_id INTEGER NOT NULL REFERENCES receptions(id) ON DELETE CASCADE,
  produit_id INTEGER NOT NULL REFERENCES produits(id) ON DELETE RESTRICT,
  quantite_commandee INTEGER NOT NULL,
  quantite_recue INTEGER NOT NULL,
  cout_unitaire NUMERIC(15, 2) NOT NULL,
  total_ligne NUMERIC(15, 2) NOT NULL,
  ecart INTEGER DEFAULT 0,
  notes TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_receptions_commande ON receptions(commande_id);
CREATE INDEX IF NOT EXISTS idx_receptions_date ON receptions(date_reception);
CREATE INDEX IF NOT EXISTS idx_reception_lignes_reception ON reception_lignes(reception_id);

-- Add barcode field to produits
ALTER TABLE produits ADD COLUMN IF NOT EXISTS code_barre VARCHAR(50) UNIQUE;
CREATE INDEX IF NOT EXISTS idx_produits_code_barre ON produits(code_barre);

-- Sequence for receipt numbering
CREATE SEQUENCE IF NOT EXISTS reception_numero_seq START 1;
