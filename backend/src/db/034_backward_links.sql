-- Add backward-link columns to factures so we can trace origin (devis / BL)
ALTER TABLE factures
ADD COLUMN IF NOT EXISTS devis_id INTEGER REFERENCES devis(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS bl_id INTEGER REFERENCES bons_livraison(id) ON DELETE SET NULL;

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_factures_devis_id ON factures(devis_id);
CREATE INDEX IF NOT EXISTS idx_factures_bl_id ON factures(bl_id);

-- Backfill existing factures from bons_livraison links
UPDATE factures f
SET bl_id = bl.id,
    devis_id = bl.devis_id
FROM bons_livraison bl
WHERE bl.facture_id = f.id
  AND f.bl_id IS NULL;

-- Also backfill from devis.facture_id for direct conversions
UPDATE factures f
SET devis_id = d.id
FROM devis d
WHERE d.facture_id = f.id
  AND f.devis_id IS NULL;
