-- Migration: Phase 5D - Link paiements to sessions_caisse
-- Adds session_caisse_id column to paiements table

-- Add session_caisse_id to link each payment to a cash register session
ALTER TABLE paiements ADD COLUMN IF NOT EXISTS session_caisse_id INTEGER REFERENCES sessions_caisse(id) ON DELETE SET NULL;

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_paiements_session ON paiements(session_caisse_id);

-- Comment
COMMENT ON COLUMN paiements.session_caisse_id IS 'Cash register session this payment belongs to';