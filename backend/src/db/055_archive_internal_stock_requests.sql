-- Phase 5: Database Archive
-- Rename tables to soft-deprecate them
ALTER TABLE internal_stock_requests RENAME TO _deprecated_internal_stock_requests;
ALTER TABLE internal_stock_request_lignes RENAME TO _deprecated_internal_stock_request_lignes;

-- Drop their update triggers so they don't interfere with anything
DROP TRIGGER IF EXISTS update_internal_stock_requests_updated_at ON _deprecated_internal_stock_requests;
DROP TRIGGER IF EXISTS update_internal_stock_request_lignes_updated_at ON _deprecated_internal_stock_request_lignes;
