-- Migration: Batch/Lot Tracking for Perishable Goods
-- Track products by batch/lot with expiration dates

-- Batches/Lots table
CREATE TABLE IF NOT EXISTS lots (
  id SERIAL PRIMARY KEY,
  produit_id INTEGER NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
  numero_lot VARCHAR(100) NOT NULL,
  date_fabrication DATE,
  date_expiration DATE,
  quantite_initiale INTEGER NOT NULL,
  quantite_restante INTEGER NOT NULL,
  prix_achat_unitaire NUMERIC(15, 2),
  fournisseur_id INTEGER REFERENCES fournisseurs(id) ON DELETE SET NULL,
  date_reception TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  statut VARCHAR(20) DEFAULT 'actif' CHECK (statut IN ('actif', 'epuise', 'expire', 'rappelle')),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Stock movements with lot tracking
ALTER TABLE mouvements_stock ADD COLUMN IF NOT EXISTS lot_id INTEGER REFERENCES lots(id) ON DELETE SET NULL;

-- Invoice lines with lot tracking
ALTER TABLE facture_lignes ADD COLUMN IF NOT EXISTS lot_id INTEGER REFERENCES lots(id) ON DELETE SET NULL;

-- Reception lines with lot tracking
ALTER TABLE reception_lignes ADD COLUMN IF NOT EXISTS lot_id INTEGER REFERENCES lots(id) ON DELETE SET NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_lots_produit ON lots(produit_id);
CREATE INDEX IF NOT EXISTS idx_lots_numero ON lots(numero_lot);
CREATE INDEX IF NOT EXISTS idx_lots_expiration ON lots(date_expiration);
CREATE INDEX IF NOT EXISTS idx_lots_statut ON lots(statut);
CREATE INDEX IF NOT EXISTS idx_lots_fournisseur ON lots(fournisseur_id);
CREATE INDEX IF NOT EXISTS idx_mouvements_stock_lot ON mouvements_stock(lot_id);
CREATE INDEX IF NOT EXISTS idx_facture_lignes_lot ON facture_lignes(lot_id);
CREATE INDEX IF NOT EXISTS idx_reception_lignes_lot ON reception_lignes(lot_id);

-- Comments
COMMENT ON TABLE lots IS 'Batch/lot tracking for perishable goods';
COMMENT ON COLUMN lots.numero_lot IS 'Batch/lot number from supplier';
COMMENT ON COLUMN lots.date_expiration IS 'Expiration date';
COMMENT ON COLUMN lots.quantite_initiale IS 'Initial quantity received';
COMMENT ON COLUMN lots.quantite_restante IS 'Remaining quantity in stock';
COMMENT ON COLUMN lots.statut IS 'Status: actif, epuise, expire, rappelle';

-- Add flag to products for lot tracking
ALTER TABLE produits ADD COLUMN IF NOT EXISTS suivi_lot BOOLEAN DEFAULT false;

COMMENT ON COLUMN produits.suivi_lot IS 'Enable lot tracking for this product';

-- Create function to auto-expire lots
CREATE OR REPLACE FUNCTION expire_old_lots() RETURNS void AS $$
BEGIN
  UPDATE lots 
  SET statut = 'expire'
  WHERE date_expiration < CURRENT_DATE 
    AND statut = 'actif'
    AND quantite_restante > 0;
END;
$$ LANGUAGE plpgsql;

-- Create view for expiring lots (next 30 days)
CREATE OR REPLACE VIEW lots_perimion AS
SELECT 
  l.*,
  p.nom as produit_nom,
  p.reference as produit_reference,
  f.nom as fournisseur_nom,
  (l.date_expiration - CURRENT_DATE) as jours_restants
FROM lots l
LEFT JOIN produits p ON l.produit_id = p.id
LEFT JOIN fournisseurs f ON l.fournisseur_id = f.id
WHERE l.date_expiration BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
  AND l.statut = 'actif'
  AND l.quantite_restante > 0
ORDER BY l.date_expiration ASC;
