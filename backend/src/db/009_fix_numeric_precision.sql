-- Migration: Fix numeric field overflow issues
-- Change NUMERIC(10,2) to NUMERIC(15,2) to support larger values
-- NUMERIC(10,2) max: 99,999,999.99
-- NUMERIC(15,2) max: 999,999,999,999,999.99 (999 trillion)

-- Step 1: Drop dependent views temporarily
DROP VIEW IF EXISTS actifs_factures;
DROP VIEW IF EXISTS actifs_commandes;
DROP VIEW IF EXISTS actifs_produits;

-- Step 2: Update factures table
ALTER TABLE factures ALTER COLUMN sous_total TYPE NUMERIC(15, 2);
ALTER TABLE factures ALTER COLUMN tva TYPE NUMERIC(15, 2);
ALTER TABLE factures ALTER COLUMN total TYPE NUMERIC(15, 2);
ALTER TABLE factures ALTER COLUMN montant_paye TYPE NUMERIC(15, 2);
ALTER TABLE factures ALTER COLUMN remaining_due TYPE NUMERIC(15, 2);

-- Update paiements table
ALTER TABLE paiements ALTER COLUMN montant TYPE NUMERIC(15, 2);

-- Update facture_lignes table
ALTER TABLE facture_lignes ALTER COLUMN prix_unitaire TYPE NUMERIC(15, 2);
ALTER TABLE facture_lignes ALTER COLUMN total_ligne TYPE NUMERIC(15, 2);

-- Update commandes_fournisseur table
ALTER TABLE commandes_fournisseur ALTER COLUMN sous_total TYPE NUMERIC(15, 2);

-- Update commande_lignes table
ALTER TABLE commande_lignes ALTER COLUMN prix_unitaire TYPE NUMERIC(15, 2);
ALTER TABLE commande_lignes ALTER COLUMN total_ligne TYPE NUMERIC(15, 2);

-- Update produits table
ALTER TABLE produits ALTER COLUMN prix_achat TYPE NUMERIC(15, 2);
ALTER TABLE produits ALTER COLUMN prix_vente TYPE NUMERIC(15, 2);

-- Update retours table (if exists)
ALTER TABLE retours ALTER COLUMN total_remboursement TYPE NUMERIC(15, 2);
ALTER TABLE retour_lignes ALTER COLUMN prix_unitaire TYPE NUMERIC(15, 2);
ALTER TABLE retour_lignes ALTER COLUMN total_ligne TYPE NUMERIC(15, 2);

-- Update receptions table (if exists)
ALTER TABLE reception_lignes ALTER COLUMN cout_unitaire TYPE NUMERIC(15, 2);
ALTER TABLE reception_lignes ALTER COLUMN total_ligne TYPE NUMERIC(15, 2);

-- Step 3: Recreate views with original definitions
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
