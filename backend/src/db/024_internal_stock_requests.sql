-- Migration: Internal stock requests (magasin -> depot)
-- Purpose: add validated internal request workflow before stock transfer execution

-- Sequence for numbering internal requests
CREATE SEQUENCE IF NOT EXISTS internal_request_numero_seq START 1;
GRANT USAGE ON SEQUENCE internal_request_numero_seq TO CURRENT_USER;

-- Internal request header
CREATE TABLE IF NOT EXISTS internal_stock_requests (
  id SERIAL PRIMARY KEY,
  numero_demande VARCHAR(50) UNIQUE NOT NULL,
  magasin_id INTEGER NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
  depot_id INTEGER NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
  statut VARCHAR(20) NOT NULL DEFAULT 'en_attente'
    CHECK (statut IN ('en_attente', 'validee', 'refusee', 'executee', 'annulee')),
  notes TEXT,
  motif_refus TEXT,
  transfer_id INTEGER REFERENCES stock_transfers(id) ON DELETE SET NULL,
  cree_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  valide_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  execute_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  date_validation TIMESTAMP,
  date_execution TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (magasin_id <> depot_id)
);

CREATE TRIGGER update_internal_stock_requests_updated_at BEFORE UPDATE ON internal_stock_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Internal request lines
CREATE TABLE IF NOT EXISTS internal_stock_request_lignes (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES internal_stock_requests(id) ON DELETE CASCADE,
  produit_id INTEGER NOT NULL REFERENCES produits(id) ON DELETE RESTRICT,
  quantite_demandee INTEGER NOT NULL CHECK (quantite_demandee > 0),
  quantite_validee INTEGER,
  quantite_transferee INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(request_id, produit_id)
);

CREATE TRIGGER update_internal_stock_request_lignes_updated_at BEFORE UPDATE ON internal_stock_request_lignes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_internal_requests_magasin ON internal_stock_requests(magasin_id);
CREATE INDEX IF NOT EXISTS idx_internal_requests_depot ON internal_stock_requests(depot_id);
CREATE INDEX IF NOT EXISTS idx_internal_requests_statut ON internal_stock_requests(statut);
CREATE INDEX IF NOT EXISTS idx_internal_requests_created_at ON internal_stock_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_internal_request_lignes_request ON internal_stock_request_lignes(request_id);
CREATE INDEX IF NOT EXISTS idx_internal_request_lignes_produit ON internal_stock_request_lignes(produit_id);

COMMENT ON TABLE internal_stock_requests IS 'Internal stock requests from magasin to depot';
COMMENT ON COLUMN internal_stock_requests.statut IS 'en_attente=pending validation, validee=approved by depot, refusee=rejected, executee=transfer completed, annulee=cancelled';
