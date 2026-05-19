-- Migration: Phase 1 Security & Stability
-- 1. Prevent negative stock with CHECK constraint
-- 2. Protect audit log (append-only)
-- 3. Add composite indexes for performance

-- ============================================
-- 1. PREVENT NEGATIVE STOCK
-- ============================================

-- First, ensure no existing products have negative stock
UPDATE produits SET stock = 0 WHERE stock < 0;

-- Add CHECK constraint to prevent negative stock
ALTER TABLE produits DROP CONSTRAINT IF EXISTS chk_stock_non_negative;
ALTER TABLE produits ADD CONSTRAINT chk_stock_non_negative CHECK (stock >= 0);

-- ============================================
-- 2. PROTECT AUDIT LOG (Append-Only)
-- ============================================

-- Revoke update and delete permissions on audit_log from application user
-- Only INSERT and SELECT should be allowed
REVOKE UPDATE, DELETE ON TABLE audit_log FROM CURRENT_USER;
GRANT INSERT, SELECT ON TABLE audit_log TO CURRENT_USER;

-- Add a note in comments that audit_log should never be modified
COMMENT ON TABLE audit_log IS 'Append-only audit log - DO NOT UPDATE OR DELETE';

-- ============================================
-- 3. COMPOSITE DATABASE INDEXES
-- ============================================

-- Invoice lines: frequently queried together
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_facture_lignes_facture_produit 
  ON facture_lignes(facture_id, produit_id);

-- Payments: searched by invoice and date
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_paiements_facture_date 
  ON paiements(facture_id, date_paiement);

-- Orders: filtered by status and date
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_commandes_fournisseur_statut_date 
  ON commandes_fournisseur(statut, date_commande);

-- Stock movements: frequently queried by product and date
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mouvements_stock_produit_date 
  ON mouvements_stock(produit_id, date_mouvement);

-- Audit log: frequently queried by table and date (using existing created_at column)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_table_date 
  ON audit_log(table_name, created_at);

-- Invoice lines: product lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_facture_lignes_produit 
  ON facture_lignes(produit_id);

-- Clients: email lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clients_email 
  ON clients(email) WHERE email IS NOT NULL AND email != '';

-- Products: barcode lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_produits_code_barre 
  ON produits(code_barre) WHERE code_barre IS NOT NULL AND code_barre != '';
