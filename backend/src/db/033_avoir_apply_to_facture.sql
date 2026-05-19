-- Add column to track which facture an avoir was applied to
ALTER TABLE factures_avoir
ADD COLUMN IF NOT EXISTS facture_appliquee_id INTEGER REFERENCES factures(id) ON DELETE SET NULL;

-- Add index for lookups
CREATE INDEX IF NOT EXISTS idx_factures_avoir_appliquee ON factures_avoir(facture_appliquee_id);
