-- Migration: user location scope mapping
-- Purpose: enforce location-based access control for operational screens/actions

CREATE TABLE IF NOT EXISTS utilisateur_locations (
  id SERIAL PRIMARY KEY,
  utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES stock_locations(id) ON DELETE CASCADE,
  est_defaut BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(utilisateur_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_utilisateur_locations_user ON utilisateur_locations(utilisateur_id);
CREATE INDEX IF NOT EXISTS idx_utilisateur_locations_location ON utilisateur_locations(location_id);

COMMENT ON TABLE utilisateur_locations IS 'Authorized stock locations per user';
COMMENT ON COLUMN utilisateur_locations.est_defaut IS 'Default working location for the user';

-- Seed default mappings for existing users when locations exist.
INSERT INTO utilisateur_locations (utilisateur_id, location_id, est_defaut)
SELECT u.id, sl.id, (sl.code = 'DEPOT-01')
FROM utilisateurs u
JOIN stock_locations sl ON sl.code IN ('DEPOT-01', 'MAG-01', 'MAG-02')
WHERE u.username = 'manager'
ON CONFLICT (utilisateur_id, location_id) DO NOTHING;

INSERT INTO utilisateur_locations (utilisateur_id, location_id, est_defaut)
SELECT u.id, sl.id, true
FROM utilisateurs u
JOIN stock_locations sl ON sl.code = 'MAG-01'
WHERE u.username = 'caissier'
ON CONFLICT (utilisateur_id, location_id) DO NOTHING;
