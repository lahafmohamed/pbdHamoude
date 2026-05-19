-- Migration: Add soft-delete columns to devis and bons_livraison
-- Up: add deleted_at, update queries to filter it
-- Down: remove deleted_at columns

-- ============================================================
-- UP
-- ============================================================

ALTER TABLE devis ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
ALTER TABLE bons_livraison ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;

-- ============================================================
-- DOWN (rollback)
-- ============================================================
-- ALTER TABLE devis DROP COLUMN IF EXISTS deleted_at;
-- ALTER TABLE bons_livraison DROP COLUMN IF EXISTS deleted_at;
