-- Migration: Serial Number Tracking for High-Value Items
-- Track individual units by serial number

-- Serial numbers table
CREATE TABLE IF NOT EXISTS numeros_serie (
  id SERIAL PRIMARY KEY,
  produit_id INTEGER NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
  numero_serie VARCHAR(100) NOT NULL,
  lot_id INTEGER REFERENCES lots(id) ON DELETE SET NULL,
  statut VARCHAR(20) DEFAULT 'en_stock' CHECK (statut IN ('en_stock', 'vendu', 'retourne', 'en_garantie', 'reforme')),
  date_achat DATE,
  date_vente DATE,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  facture_id INTEGER REFERENCES factures(id) ON DELETE SET NULL,
  prix_vente NUMERIC(15, 2),
  garantie_jusqu DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(produit_id, numero_serie)
);

-- Stock movements with serial number
ALTER TABLE mouvements_stock ADD COLUMN IF NOT EXISTS numero_serie_id INTEGER REFERENCES numeros_serie(id) ON DELETE SET NULL;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_numeros_serie_unique ON numeros_serie(produit_id, numero_serie);
CREATE INDEX IF NOT EXISTS idx_numeros_serie_produit ON numeros_serie(produit_id);
CREATE INDEX IF NOT EXISTS idx_numeros_serie_statut ON numeros_serie(statut);
CREATE INDEX IF NOT EXISTS idx_numeros_serie_client ON numeros_serie(client_id);
CREATE INDEX IF NOT EXISTS idx_numeros_serie_facture ON numeros_serie(facture_id);
CREATE INDEX IF NOT EXISTS idx_numeros_serie_garantie ON numeros_serie(garantie_jusqu);
CREATE INDEX IF NOT EXISTS idx_mouvements_stock_serial ON mouvements_stock(numero_serie_id);

-- Comments
COMMENT ON TABLE numeros_serie IS 'Serial number tracking for high-value items';
COMMENT ON COLUMN numeros_serie.numero_serie IS 'Unique serial number';
COMMENT ON COLUMN numeros_serie.statut IS 'Current status of the item';
COMMENT ON COLUMN numeros_serie.date_vente IS 'Sale date';
COMMENT ON COLUMN numeros_serie.garantie_jusqu IS 'Warranty expiration date';

-- Add flag to products for serial number tracking
ALTER TABLE produits ADD COLUMN IF NOT EXISTS suivi_serial BOOLEAN DEFAULT false;
ALTER TABLE produits ADD COLUMN IF NOT EXISTS garantie_mois INTEGER DEFAULT 0;

COMMENT ON COLUMN produits.suivi_serial IS 'Enable serial number tracking for this product';
COMMENT ON COLUMN produits.garantie_mois IS 'Default warranty period in months';

-- Create view for items under warranty
CREATE OR REPLACE VIEW articles_sous_garantie AS
SELECT 
  ns.*,
  p.nom as produit_nom,
  p.reference as produit_reference,
  c.nom as client_nom,
  c.prenom as client_prenom,
  c.telephone as client_telephone,
  f.numero_facture,
  (ns.garantie_jusqu - CURRENT_DATE) as jours_garantie_restants
FROM numeros_serie ns
LEFT JOIN produits p ON ns.produit_id = p.id
LEFT JOIN clients c ON ns.client_id = c.id
LEFT JOIN factures f ON ns.facture_id = f.id
WHERE ns.statut = 'vendu'
  AND ns.garantie_jusqu >= CURRENT_DATE
ORDER BY ns.garantie_jusqu ASC;

-- Create view for sold items by serial number
CREATE OR REPLACE VIEW ventes_par_serial AS
SELECT 
  ns.id,
  ns.numero_serie,
  p.nom as produit_nom,
  p.reference as produit_reference,
  ns.prix_vente,
  ns.date_vente,
  c.nom as client_nom,
  c.prenom as client_prenom,
  c.telephone as client_telephone,
  f.numero_facture,
  ns.garantie_jusqu,
  ns.statut
FROM numeros_serie ns
LEFT JOIN produits p ON ns.produit_id = p.id
LEFT JOIN clients c ON ns.client_id = c.id
LEFT JOIN factures f ON ns.facture_id = f.id
WHERE ns.statut = 'vendu'
ORDER BY ns.date_vente DESC;
