-- Migration 027: Enforce tax-free environment
-- This store operates with 0 tax. Constrain the tva column to prevent
-- accidental future inserts with a non-zero tax value.

-- Reset any legacy rows that may have non-zero tva
UPDATE factures SET tva = 0 WHERE tva <> 0;

-- Add CHECK constraint to block future non-zero tva inserts/updates
ALTER TABLE factures
  ADD CONSTRAINT factures_tva_zero CHECK (tva = 0);
