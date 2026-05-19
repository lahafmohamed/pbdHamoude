-- Migration: Phase 5 Quick Wins - Invoice Enhancements
-- Adds: date_echeance, hors_taxe, location_id to factures table

-- ============================================================
-- 1. ADD PAYMENT DUE DATE TO CUSTOMER INVOICES
-- ============================================================

ALTER TABLE factures ADD COLUMN IF NOT EXISTS date_echeance DATE;
ALTER TABLE factures ADD COLUMN IF NOT EXISTS delai_paiement VARCHAR(50);

COMMENT ON COLUMN factures.date_echeance IS 'Payment due date';
COMMENT ON COLUMN factures.delai_paiement IS 'Payment terms: immediat, net_30, net_60, net_90';

-- Index for aging reports
CREATE INDEX IF NOT EXISTS idx_factures_echeance ON factures(date_echeance);

-- ============================================================
-- 2. ADD HORS TAXE (TAX-EXEMPT) SUPPORT
-- ============================================================

ALTER TABLE factures ADD COLUMN IF NOT EXISTS hors_taxe BOOLEAN DEFAULT false;
ALTER TABLE factures ADD COLUMN IF NOT EXISTS exoneration_raison VARCHAR(100);

COMMENT ON COLUMN factures.hors_taxe IS 'True if invoice is tax-exempt';
COMMENT ON COLUMN factures.exoneration_raison IS 'Reason for tax exemption (export, diplomatic, etc.)';

-- ============================================================
-- 3. ADD LOCATION (MAGASIN/DEPOT) TRACKING
-- ============================================================

ALTER TABLE factures ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES stock_locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_factures_location ON factures(location_id);

COMMENT ON COLUMN factures.location_id IS 'Store/warehouse location where sale was made';

-- ============================================================
-- 4. ADD HT/TTC BREAKDOWN COLUMNS
-- ============================================================

ALTER TABLE factures ADD COLUMN IF NOT EXISTS total_ht NUMERIC(15, 2);
ALTER TABLE factures ADD COLUMN IF NOT EXISTS total_ttc NUMERIC(15, 2);

COMMENT ON COLUMN factures.total_ht IS 'Total hors taxes (before tax)';
COMMENT ON COLUMN factures.total_ttc IS 'Total toutes taxes comprises (after tax)';

-- Initialize HT and TTC from existing data for backward compatibility
UPDATE factures 
SET 
  total_ht = sous_total,
  total_ttc = total
WHERE total_ht IS NULL;

-- ============================================================
-- 5. ADD INVOICE TYPE ENUM
-- ============================================================

ALTER TABLE factures ADD COLUMN IF NOT EXISTS type_facture VARCHAR(20) DEFAULT 'standard' 
  CHECK (type_facture IN ('standard', 'avoir', 'echange'));

COMMENT ON COLUMN factures.type_facture IS 'Invoice type: standard, avoir (credit note), echange (exchange)';

CREATE INDEX IF NOT EXISTS idx_factures_type ON factures(type_facture);

-- ============================================================
-- 6. UPDATE TRIGGER TO AUTO-CALCULATE HT/TTC
-- ============================================================

CREATE OR REPLACE FUNCTION update_facture_ht_ttc()
RETURNS TRIGGER AS $$
BEGIN
  NEW.total_ht := NEW.sous_total;
  NEW.total_ttc := NEW.total;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_facture_ht_ttc
  BEFORE INSERT OR UPDATE ON factures
  FOR EACH ROW
  EXECUTE FUNCTION update_facture_ht_ttc();
