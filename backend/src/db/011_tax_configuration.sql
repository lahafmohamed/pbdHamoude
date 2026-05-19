-- Migration: Tax Configuration Engine
-- Remove hardcoded 19% TVA and make tax rates configurable

-- Table for tax rates
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

-- Insert default tax rates for Algeria
INSERT INTO taux_tva (code, taux, description) VALUES
  ('TVA_19', 19.00, 'Taux normal - 19%'),
  ('TVA_9', 9.00, 'Taux réduit - 9%'),
  ('TVA_0', 0.00, 'Exonéré - 0%')
ON CONFLICT (code) DO NOTHING;

-- Add tax rate reference to facture_lignes
ALTER TABLE facture_lignes ADD COLUMN IF NOT EXISTS taux_tva_id INTEGER REFERENCES taux_tva(id);
ALTER TABLE facture_lignes ADD COLUMN IF NOT EXISTS montant_tva NUMERIC(15, 2) DEFAULT 0.00;

-- Add global discount to factures table
ALTER TABLE factures ADD COLUMN IF NOT EXISTS remise_globale NUMERIC(15, 2) DEFAULT 0.00;
ALTER TABLE factures ADD COLUMN IF NOT EXISTS remise_globale_pct NUMERIC(5, 2) DEFAULT 0.00;

-- Update existing invoice lines to use default tax rate (19%)
UPDATE facture_lignes 
SET taux_tva_id = (SELECT id FROM taux_tva WHERE code = 'TVA_19' LIMIT 1)
WHERE taux_tva_id IS NULL;

-- Add comments
COMMENT ON TABLE taux_tva IS 'Configuration des taux de TVA';
COMMENT ON COLUMN facture_lignes.taux_tva_id IS 'Référence au taux TVA appliqué';
COMMENT ON COLUMN facture_lignes.montant_tva IS 'Montant TVA calculé pour cette ligne';
COMMENT ON COLUMN factures.remise_globale IS 'Remise globale en montant avant TVA';
COMMENT ON COLUMN factures.remise_globale_pct IS 'Remise globale en pourcentage';

-- Create index for tax rate lookup
CREATE INDEX IF NOT EXISTS idx_taux_tva_actif ON taux_tva(actif) WHERE actif = true;
