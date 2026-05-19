-- Migration: Historique des mouvements de stock

-- Table des mouvements de stock
CREATE TABLE IF NOT EXISTS mouvements_stock (
  id SERIAL PRIMARY KEY,
  produit_id INTEGER NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
  type_mouvement VARCHAR(20) NOT NULL CHECK (type_mouvement IN ('vente', 'ajustement', 'retour', 'commande', 'perte', 'autre')),
  quantite INTEGER NOT NULL,
  stock_avant INTEGER NOT NULL,
  stock_apres INTEGER NOT NULL,
  raison TEXT,
  reference_liee VARCHAR(50),
  date_mouvement TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index pour les recherches rapides
CREATE INDEX IF NOT EXISTS idx_mouvement_produit ON mouvements_stock(produit_id);
CREATE INDEX IF NOT EXISTS idx_mouvement_date ON mouvements_stock(date_mouvement);
CREATE INDEX IF NOT EXISTS idx_mouvement_type ON mouvements_stock(type_mouvement);

-- Fonction pour logger les mouvements automatiquement
CREATE OR REPLACE FUNCTION log_mouvement_stock()
RETURNS TRIGGER AS $$
BEGIN
  -- On log uniquement si le stock a changé
  IF OLD.stock IS DISTINCT FROM NEW.stock THEN
    INSERT INTO mouvements_stock (produit_id, type_mouvement, quantite, stock_avant, stock_apres, raison)
    VALUES (
      NEW.id,
      'ajustement',
      NEW.stock - OLD.stock,
      OLD.stock,
      NEW.stock,
      'Mise à jour manuelle'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger sur les produits (activé pour suivre les mouvements de stock)
CREATE TRIGGER log_produits_stock
  AFTER UPDATE ON produits
  FOR EACH ROW
  EXECUTE FUNCTION log_mouvement_stock();
