-- ============================================================
-- 053_depenses_soft_delete.sql
-- Add soft-delete column to depenses (referenced by DepenseServiceV2)
-- ============================================================

ALTER TABLE depenses
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_depenses_deleted_at
  ON depenses(deleted_at)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN depenses.deleted_at IS
  'Soft delete marker. NULL = active. Filtered out in DepenseServiceV2.getAll.';
