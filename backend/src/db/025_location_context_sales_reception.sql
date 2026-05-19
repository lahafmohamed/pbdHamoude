-- Migration: Add explicit location context for POS sessions and receptions
-- Purpose: ensure stock movements are tied to a specific location

ALTER TABLE pos_sessions
  ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES stock_locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pos_sessions_location ON pos_sessions(location_id);

COMMENT ON COLUMN pos_sessions.location_id IS 'Location where the POS session operates';

ALTER TABLE receptions
  ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES stock_locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_receptions_location ON receptions(location_id);

COMMENT ON COLUMN receptions.location_id IS 'Location where goods were physically received';
