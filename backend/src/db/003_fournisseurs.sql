-- Migration: Gestion des Fournisseurs et Commandes

-- Table des fournisseurs
CREATE TABLE IF NOT EXISTS fournisseurs (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(255) NOT NULL,
  contact VARCHAR(255),
  telephone VARCHAR(20),
  email VARCHAR(255),
  adresse TEXT,
  delai_livraison INTEGER DEFAULT 7,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Trigger pour updated_at
CREATE TRIGGER update_fournisseurs_updated_at BEFORE UPDATE ON fournisseurs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Table des commandes fournisseur
CREATE TABLE IF NOT EXISTS commandes_fournisseur (
  id SERIAL PRIMARY KEY,
  fournisseur_id INTEGER NOT NULL REFERENCES fournisseurs(id) ON DELETE RESTRICT,
  numero_commande VARCHAR(50) UNIQUE NOT NULL,
  date_commande TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  date_livraison_prevue DATE,
  date_livraison_reelle DATE,
  statut VARCHAR(20) DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'validee', 'expediee', 'livree', 'annulee')),
  sous_total NUMERIC(15, 2) DEFAULT 0.00,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table des lignes de commande
CREATE TABLE IF NOT EXISTS commande_lignes (
  id SERIAL PRIMARY KEY,
  commande_id INTEGER NOT NULL REFERENCES commandes_fournisseur(id) ON DELETE CASCADE,
  produit_id INTEGER NOT NULL REFERENCES produits(id) ON DELETE RESTRICT,
  quantite INTEGER NOT NULL DEFAULT 1,
  prix_unitaire NUMERIC(15, 2) NOT NULL,
  total_ligne NUMERIC(15, 2) NOT NULL
);

-- Ajouter colonne fournisseur_id aux produits
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'produits' AND column_name = 'fournisseur_id') THEN
    ALTER TABLE produits ADD COLUMN fournisseur_id INTEGER REFERENCES fournisseurs(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Index pour les recherches rapides
CREATE INDEX IF NOT EXISTS idx_fournisseur_nom ON fournisseurs(nom);
CREATE INDEX IF NOT EXISTS idx_commande_fournisseur ON commandes_fournisseur(fournisseur_id);
CREATE INDEX IF NOT EXISTS idx_commande_date ON commandes_fournisseur(date_commande);
CREATE INDEX IF NOT EXISTS idx_commande_statut ON commandes_fournisseur(statut);
CREATE INDEX IF NOT EXISTS idx_commande_ligne_commande ON commande_lignes(commande_id);
CREATE INDEX IF NOT EXISTS idx_produit_fournisseur ON produits(fournisseur_id);
