-- Migration 038: P1 fixes
-- 1. Mobile money payment methods (Orange Money, MTN, Wave — CI market)
-- 2. Add RCCM + NIF fields to clients and fournisseurs
-- 3. Supplier payment trigger: extend to DELETE + UPDATE
-- 4. Supplier running ledger (compte_fournisseur_lignes)
-- 5. FIFO performance indexes

-- ============================================================
-- 1. EXTEND methode_paiement CHECK ON paiements
-- ============================================================

ALTER TABLE paiements
  DROP CONSTRAINT IF EXISTS paiements_methode_paiement_check;

ALTER TABLE paiements
  ADD CONSTRAINT paiements_methode_paiement_check
  CHECK (methode_paiement IN ('espece', 'carte', 'cheque', 'virement', 'mobile_money', 'orange_money', 'mtn_money', 'wave'));

ALTER TABLE paiements_fournisseur
  DROP CONSTRAINT IF EXISTS paiements_fournisseur_methode_paiement_check;

ALTER TABLE paiements_fournisseur
  ADD CONSTRAINT paiements_fournisseur_methode_paiement_check
  CHECK (methode_paiement IN ('espece', 'carte', 'cheque', 'virement', 'mobile_money', 'orange_money', 'mtn_money', 'wave'));

-- ============================================================
-- 2. RCCM + NIF FIELDS
-- ============================================================

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS rccm VARCHAR(50);

ALTER TABLE fournisseurs
  ADD COLUMN IF NOT EXISTS nif VARCHAR(50);

ALTER TABLE fournisseurs
  ADD COLUMN IF NOT EXISTS rccm VARCHAR(50);

-- ============================================================
-- 3. SUPPLIER PAYMENT TRIGGER: INSERT + UPDATE + DELETE
-- ============================================================

DROP TRIGGER IF EXISTS trg_after_paiement_ff_insert ON paiements_fournisseur;
DROP TRIGGER IF EXISTS trg_paiement_ff_iud ON paiements_fournisseur;

CREATE OR REPLACE FUNCTION update_facture_fournisseur_payment_status()
RETURNS TRIGGER AS $$
DECLARE
  v_facture_id INTEGER;
  total_due NUMERIC(15, 2);
  total_paid NUMERIC(15, 2);
BEGIN
  v_facture_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.facture_id ELSE NEW.facture_id END;

  SELECT total INTO total_due FROM factures_fournisseur WHERE id = v_facture_id;
  SELECT COALESCE(SUM(montant), 0) INTO total_paid
  FROM paiements_fournisseur WHERE facture_id = v_facture_id;

  UPDATE factures_fournisseur
  SET
    montant_paye = total_paid,
    reste_due   = total_due - total_paid,
    statut = CASE
      WHEN total_paid = 0 THEN 'en_attente'
      WHEN total_paid < total_due THEN 'partiellement_payee'
      ELSE 'payee'
    END
  WHERE id = v_facture_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_paiement_ff_iud
  AFTER INSERT OR UPDATE OR DELETE ON paiements_fournisseur
  FOR EACH ROW EXECUTE FUNCTION update_facture_fournisseur_payment_status();

-- ============================================================
-- 4. SUPPLIER RUNNING LEDGER (AP equivalent of compte_client_lignes)
--    montant_debit  = payment made (reduces AP liability)
--    montant_credit = new invoice received (increases AP liability)
-- ============================================================

CREATE TABLE IF NOT EXISTS compte_fournisseur_lignes (
  id SERIAL PRIMARY KEY,
  fournisseur_id INTEGER NOT NULL REFERENCES fournisseurs(id) ON DELETE RESTRICT,
  type_operation VARCHAR(30) NOT NULL CHECK (type_operation IN ('facture', 'paiement', 'avoir', 'ajustement')),
  document_id INTEGER,
  document_numero VARCHAR(100),
  montant_debit NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  montant_credit NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  notes TEXT,
  cree_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cfl_fournisseur ON compte_fournisseur_lignes(fournisseur_id);
CREATE INDEX IF NOT EXISTS idx_cfl_type       ON compte_fournisseur_lignes(type_operation);
CREATE INDEX IF NOT EXISTS idx_cfl_document   ON compte_fournisseur_lignes(type_operation, document_id);

-- ============================================================
-- 5. FIFO PERFORMANCE INDEXES
-- ============================================================

-- Composite index for FIFO invoice scan (client_id + sort columns)
CREATE INDEX IF NOT EXISTS idx_factures_client_date
  ON factures(client_id, date_facture, id)
  WHERE deleted_at IS NULL;

-- Composite index for FIFO payment scan (via JOIN to factures)
CREATE INDEX IF NOT EXISTS idx_paiements_date_id
  ON paiements(date_paiement, id);
