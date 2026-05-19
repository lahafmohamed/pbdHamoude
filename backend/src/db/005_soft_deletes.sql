-- Migration: Soft Deletes for all major tables

-- Add deleted_at columns
DO $$ BEGIN
  ALTER TABLE produits ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
  ALTER TABLE factures ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
  ALTER TABLE fournisseurs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
  ALTER TABLE commandes_fournisseur ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
END $$;

-- Add indexes for filtering soft-deleted records
CREATE INDEX IF NOT EXISTS idx_produits_deleted_at ON produits(deleted_at);
CREATE INDEX IF NOT EXISTS idx_clients_deleted_at ON clients(deleted_at);
CREATE INDEX IF NOT EXISTS idx_factures_deleted_at ON factures(deleted_at);
CREATE INDEX IF NOT EXISTS idx_fournisseurs_deleted_at ON fournisseurs(deleted_at);
CREATE INDEX IF NOT EXISTS idx_commandes_fournisseur_deleted_at ON commandes_fournisseur(deleted_at);

-- Create views for active (non-deleted) records
CREATE OR REPLACE VIEW actifs_produits AS
  SELECT * FROM produits WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW actifs_clients AS
  SELECT * FROM clients WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW actifs_factures AS
  SELECT * FROM factures WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW actifs_fournisseurs AS
  SELECT * FROM fournisseurs WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW actifs_commandes AS
  SELECT * FROM commandes_fournisseur WHERE deleted_at IS NULL;
