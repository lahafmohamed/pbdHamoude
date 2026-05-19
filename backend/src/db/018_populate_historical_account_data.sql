-- Migration: Populate customer account ledger with historical data
-- This migrates existing invoices and payments into the new compte_client_lignes system

-- ============================================
-- 1. ADD LEDGER LINES FOR ALL INVOICES
-- ============================================

INSERT INTO compte_client_lignes (
  client_id, 
  date_operation, 
  type_operation, 
  document_id, 
  document_numero, 
  montant_debit, 
  montant_credit, 
  solde_avant, 
  solde_apres,
  notes
)
SELECT 
  f.client_id,
  f.date_facture,
  'facture',
  f.id,
  f.numero_facture,
  f.total,
  0,
  0, -- Will be recalculated
  f.total, -- Will be recalculated
  'Migration historique'
FROM factures f
WHERE f.statut != 'annulee'
  AND f.deleted_at IS NULL
ORDER BY f.date_facture ASC;

-- ============================================
-- 2. ADD LEDGER LINES FOR ALL PAYMENTS
-- ============================================

INSERT INTO compte_client_lignes (
  client_id,
  date_operation,
  type_operation,
  document_id,
  document_numero,
  montant_debit,
  montant_credit,
  solde_avant,
  solde_apres,
  notes
)
SELECT 
  f.client_id,
  p.date_paiement,
  'paiement',
  p.id,
  f.numero_facture,
  0,
  p.montant,
  0, -- Will be recalculated
  -p.montant, -- Will be recalculated
  'Migration historique - ' || p.methode_paiement
FROM paiements p
INNER JOIN factures f ON p.facture_id = f.id
ORDER BY p.date_paiement ASC;

-- ============================================
-- 3. RECALCULATE ALL BALANCES
-- ============================================

-- Create temporary function to recalculate balances
DO $$
DECLARE
  v_client_id INTEGER;
  v_line RECORD;
  v_running_balance NUMERIC(15, 2) := 0;
BEGIN
  -- Get all unique client IDs that have ledger lines
  FOR v_client_id IN 
    SELECT DISTINCT client_id FROM compte_client_lignes
  LOOP
    v_running_balance := 0;
    
    -- Process each line in chronological order
    FOR v_line IN
      SELECT id, montant_debit, montant_credit, solde_avant, solde_apres
      FROM compte_client_lignes
      WHERE client_id = v_client_id
      ORDER BY date_operation ASC, id ASC
    LOOP
      v_running_balance := v_running_balance + v_line.montant_debit - v_line.montant_credit;
      
      UPDATE compte_client_lignes
      SET solde_avant = v_running_balance - v_line.montant_debit + v_line.montant_credit,
          solde_apres = v_running_balance
      WHERE id = v_line.id;
    END LOOP;
    
    -- Update client's current balance
    UPDATE clients
    SET solde_actuel = v_running_balance
    WHERE id = v_client_id;
  END LOOP;
END $$;

-- ============================================
-- 4. VERIFY RESULTS
-- ============================================

-- Show summary
SELECT 
  c.nom,
  c.prenom,
  COUNT(ccl.id) as nombre_operations,
  SUM(ccl.montant_debit) as total_factures,
  SUM(ccl.montant_credit) as total_paiements,
  MAX(ccl.solde_apres) as solde_calculé
FROM clients c
LEFT JOIN compte_client_lignes ccl ON c.id = ccl.client_id
WHERE c.deleted_at IS NULL
GROUP BY c.id, c.nom, c.prenom
HAVING COUNT(ccl.id) > 0
ORDER BY c.nom;
