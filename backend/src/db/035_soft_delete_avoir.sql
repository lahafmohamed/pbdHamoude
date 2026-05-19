-- Add soft-delete column to factures_avoir (was missed in 031)
ALTER TABLE factures_avoir ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_factures_avoir_deleted_at ON factures_avoir(deleted_at);
