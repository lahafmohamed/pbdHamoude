-- Schema PostgreSQL pour magasin_db

-- Table des produits
CREATE TABLE IF NOT EXISTS produits (
  id SERIAL PRIMARY KEY,
  reference VARCHAR(50) UNIQUE NOT NULL,
  nom VARCHAR(255) NOT NULL,
  description TEXT,
  categorie VARCHAR(100),
  prix_achat NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  prix_vente NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  stock INTEGER NOT NULL DEFAULT 0,
  stock_min INTEGER NOT NULL DEFAULT 5,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Trigger pour updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_produits_updated_at BEFORE UPDATE ON produits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Table des clients
CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(100) NOT NULL,
  prenom VARCHAR(100),
  email VARCHAR(255),
  telephone VARCHAR(20),
  adresse TEXT,
  nif VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Table des taux de TVA (needed before document_lignes FK)
CREATE TABLE IF NOT EXISTS taux_tva (
  id SERIAL PRIMARY KEY,
  code VARCHAR(20) UNIQUE NOT NULL,
  taux NUMERIC(5, 2) NOT NULL,
  description TEXT,
  actif BOOLEAN DEFAULT true,
  date_debut DATE DEFAULT CURRENT_DATE,
  date_fin DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table des factures
CREATE TABLE IF NOT EXISTS factures (
  id SERIAL PRIMARY KEY,
  numero_facture VARCHAR(50) UNIQUE NOT NULL,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  devis_id INTEGER,
  bl_id INTEGER,
  date_facture TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sous_total NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  tva NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  total NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  montant_paye NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  remaining_due NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  statut VARCHAR(20) DEFAULT 'en_attente' CHECK (statut IN ('payee', 'partielle', 'en_attente', 'annulee')),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table des paiements
CREATE TABLE IF NOT EXISTS paiements (
  id SERIAL PRIMARY KEY,
  facture_id INTEGER NOT NULL REFERENCES factures(id) ON DELETE CASCADE,
  montant NUMERIC(15, 2) NOT NULL,
  methode_paiement VARCHAR(50) NOT NULL CHECK (methode_paiement IN ('espece', 'carte', 'cheque', 'virement')),
  date_paiement TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reference VARCHAR(100),
  notes TEXT,
  cree_par INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table unifiée des lignes de document (factures, devis, bons de livraison, avoirs)
CREATE TABLE IF NOT EXISTS document_lignes (
  id SERIAL PRIMARY KEY,
  document_type VARCHAR(20) NOT NULL CHECK (document_type IN ('facture', 'devis', 'bl', 'avoir')),
  document_id INTEGER NOT NULL,
  produit_id INTEGER REFERENCES produits(id) ON DELETE SET NULL,
  parent_ligne_id INTEGER,
  quantite INTEGER NOT NULL DEFAULT 1,
  prix_unitaire NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  montant_tva NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  total_ligne NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  description VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Default TVA rates
INSERT INTO taux_tva (code, taux, description) VALUES
  ('TVA_19', 19.00, 'Taux normal - 19%'),
  ('TVA_9', 9.00, 'Taux réduit - 9%'),
  ('TVA_0', 0.00, 'Exonéré - 0%')
ON CONFLICT (code) DO NOTHING;

-- Index pour les recherches rapides
CREATE INDEX IF NOT EXISTS idx_produit_nom ON produits(nom);
CREATE INDEX IF NOT EXISTS idx_produit_reference ON produits(reference);
CREATE INDEX IF NOT EXISTS idx_produit_categorie ON produits(categorie);
CREATE INDEX IF NOT EXISTS idx_client_nom ON clients(nom);
CREATE INDEX IF NOT EXISTS idx_facture_date ON factures(date_facture);
CREATE INDEX IF NOT EXISTS idx_facture_client ON factures(client_id);
CREATE INDEX IF NOT EXISTS idx_facture_statut ON factures(statut);
CREATE INDEX IF NOT EXISTS idx_document_lignes_document ON document_lignes(document_type, document_id);
CREATE INDEX IF NOT EXISTS idx_document_lignes_produit ON document_lignes(produit_id);
CREATE INDEX IF NOT EXISTS idx_paiements_facture ON paiements(facture_id);
CREATE INDEX IF NOT EXISTS idx_paiements_date ON paiements(date_paiement);
CREATE INDEX IF NOT EXISTS idx_paiements_methode ON paiements(methode_paiement);

-- Trigger pour mise à jour automatique du statut de facture
CREATE OR REPLACE FUNCTION update_facture_payment_status()
RETURNS TRIGGER AS $$
DECLARE
  v_facture_id INTEGER;
  total_due NUMERIC(15, 2);
  total_paid NUMERIC(15, 2);
BEGIN
  -- On DELETE, NEW is null; use OLD.facture_id
  v_facture_id := COALESCE(NEW.facture_id, OLD.facture_id);

  SELECT total INTO total_due FROM factures WHERE id = v_facture_id;
  SELECT COALESCE(SUM(montant), 0) INTO total_paid
  FROM paiements
  WHERE facture_id = v_facture_id;
  
  UPDATE factures 
  SET 
    montant_paye = total_paid,
    remaining_due = total_due - total_paid,
    statut = CASE
      WHEN total_paid = 0 THEN 'en_attente'
      WHEN total_paid < total_due THEN 'partielle'
      WHEN total_paid >= total_due THEN 'payee'
    END
  WHERE id = v_facture_id;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_after_payment_insert ON paiements;
CREATE TRIGGER trg_after_payment_insert
  AFTER INSERT OR UPDATE OR DELETE ON paiements
  FOR EACH ROW
  EXECUTE FUNCTION update_facture_payment_status();
