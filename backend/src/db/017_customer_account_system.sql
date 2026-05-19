-- Migration: Customer Account System
-- Track advance payments, account balances, and statements

-- ============================================
-- 1. ADVANCE PAYMENTS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS acomptes_clients (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  montant NUMERIC(15, 2) NOT NULL,
  methode_paiement VARCHAR(50) CHECK (methode_paiement IN ('espece', 'carte', 'cheque', 'virement')),
  date_acompte TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  statut VARCHAR(20) DEFAULT 'disponible' CHECK (statut IN ('disponible', 'utilise', 'rembourse')),
  facture_id_applique INTEGER REFERENCES factures(id) ON DELETE SET NULL,
  date_utilisation TIMESTAMP,
  notes TEXT,
  cree_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_acomptes_client ON acomptes_clients(client_id);
CREATE INDEX IF NOT EXISTS idx_acomptes_statut ON acomptes_clients(statut);
CREATE INDEX IF NOT EXISTS idx_acomptes_date ON acomptes_clients(date_acompte);
CREATE INDEX IF NOT EXISTS idx_acomptes_facture ON acomptes_clients(facture_id_applique);

COMMENT ON TABLE acomptes_clients IS 'Advance payments from customers';
COMMENT ON COLUMN acomptes_clients.statut IS 'disponible=available, utilise=used, rembourse=refunded';

-- ============================================
-- 2. CUSTOMER ACCOUNT LEDGER (Transaction History)
-- ============================================

CREATE TABLE IF NOT EXISTS compte_client_lignes (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date_operation TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  type_operation VARCHAR(50) NOT NULL CHECK (type_operation IN (
    'facture', 'paiement', 'acompte', 'avoir', 'remise', 'ajustement'
  )),
  document_id INTEGER,
  document_numero VARCHAR(100),
  montant_debit NUMERIC(15, 2) DEFAULT 0.00,
  montant_credit NUMERIC(15, 2) DEFAULT 0.00,
  solde_avant NUMERIC(15, 2) DEFAULT 0.00,
  solde_apres NUMERIC(15, 2) DEFAULT 0.00,
  notes TEXT,
  cree_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_compte_client_client ON compte_client_lignes(client_id);
CREATE INDEX IF NOT EXISTS idx_compte_client_date ON compte_client_lignes(date_operation);
CREATE INDEX IF NOT EXISTS idx_compte_client_type ON compte_client_lignes(type_operation);
CREATE INDEX IF NOT EXISTS idx_compte_client_document ON compte_client_lignes(document_id, type_operation);

COMMENT ON TABLE compte_client_lignes IS 'Customer account ledger - transaction history';
COMMENT ON COLUMN compte_client_lignes.type_operation IS 'facture=invoice, paiement=payment, acompte=advance, avoir=credit note';
COMMENT ON COLUMN compte_client_lignes.montant_debit IS 'Amount customer owes (increases balance)';
COMMENT ON COLUMN compte_client_lignes.montant_credit IS 'Amount customer paid/credit (decreases balance)';

-- ============================================
-- 3. ADD BALANCE COLUMNS TO CLIENTS
-- ============================================

ALTER TABLE clients ADD COLUMN IF NOT EXISTS solde_actuel NUMERIC(15, 2) DEFAULT 0.00;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS acompte_disponible NUMERIC(15, 2) DEFAULT 0.00;

COMMENT ON COLUMN clients.solde_actuel IS 'Current balance: positive = customer owes, negative = we owe customer';
COMMENT ON COLUMN clients.acompte_disponible IS 'Available advance amount';

-- ============================================
-- 4. CREATE VIEWS
-- ============================================

-- View: Customer account summary
CREATE OR REPLACE VIEW vue_solde_clients AS
SELECT 
  c.id,
  c.nom,
  c.prenom,
  c.credit_max,
  c.credit_encours,
  c.solde_actuel,
  c.acompte_disponible,
  c.delai_paiement,
  (c.credit_max - c.solde_actuel) as credit_disponible,
  CASE 
    WHEN c.solde_actuel > 0 THEN 'debiteur'
    WHEN c.solde_actuel < 0 THEN 'crediteur'
    ELSE 'solde_nul'
  END as statut_solde
FROM clients c
WHERE c.deleted_at IS NULL;

-- View: Available advances
CREATE OR REPLACE VIEW vue_acomptes_disponibles AS
SELECT 
  ac.*,
  c.nom as client_nom,
  c.prenom as client_prenom
FROM acomptes_clients ac
INNER JOIN clients c ON ac.client_id = c.id
WHERE ac.statut = 'disponible'
  AND c.deleted_at IS NULL
ORDER BY ac.date_acompte ASC;

-- ============================================
-- 5. CREATE FUNCTIONS
-- ============================================

-- Function: Calculate customer balance
CREATE OR REPLACE FUNCTION calculer_solde_client(p_client_id INTEGER)
RETURNS NUMERIC(15, 2) AS $$
DECLARE
  v_solde NUMERIC(15, 2);
BEGIN
  SELECT COALESCE(SUM(montant_debit), 0) - COALESCE(SUM(montant_credit), 0)
  INTO v_solde
  FROM compte_client_lignes
  WHERE client_id = p_client_id;
  
  RETURN v_solde;
END;
$$ LANGUAGE plpgsql;

-- Function: Calculate available advance
CREATE OR REPLACE FUNCTION calculer_acompte_disponible(p_client_id INTEGER)
RETURNS NUMERIC(15, 2) AS $$
DECLARE
  v_acompte NUMERIC(15, 2);
BEGIN
  SELECT COALESCE(SUM(montant), 0)
  INTO v_acompte
  FROM acomptes_clients
  WHERE client_id = p_client_id
    AND statut = 'disponible';
  
  RETURN v_acompte;
END;
$$ LANGUAGE plpgsql;

-- Function: Update client balance
CREATE OR REPLACE FUNCTION update_client_solde()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE clients 
    SET solde_actuel = calculer_solde_client(NEW.client_id)
    WHERE id = NEW.client_id;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE clients 
    SET solde_actuel = calculer_solde_client(NEW.client_id)
    WHERE id = NEW.client_id;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Auto-update client balance on ledger change
DROP TRIGGER IF EXISTS trigger_update_client_solde ON compte_client_lignes;
CREATE TRIGGER trigger_update_client_solde
  AFTER INSERT OR UPDATE ON compte_client_lignes
  FOR EACH ROW
  EXECUTE FUNCTION update_client_solde();

-- ============================================
-- 6. INITIALIZE EXISTING DATA
-- ============================================

-- Set initial solde_actuel from existing credit_encours
UPDATE clients SET solde_actuel = credit_encours WHERE credit_encours > 0;

-- Update all client balances
UPDATE clients SET solde_actuel = 0 WHERE solde_actuel IS NULL;
