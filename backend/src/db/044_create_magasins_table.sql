-- Migration: Create dedicated magasins table for cash register management
-- Separates cash management concerns from stock_locations

-- ============================================
-- 1. CREATE MAGASINS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS magasins (
  id SERIAL PRIMARY KEY,
  location_id INTEGER REFERENCES stock_locations(id) ON DELETE CASCADE,
  code VARCHAR(20) UNIQUE NOT NULL,
  nom VARCHAR(100) NOT NULL,
  adresse TEXT,
  telephone VARCHAR(50),
  actif BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_magasins_updated_at BEFORE UPDATE ON magasins
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Index
CREATE INDEX IF NOT EXISTS idx_magasins_location ON magasins(location_id);
CREATE INDEX IF NOT EXISTS idx_magasins_code ON magasins(code);

-- ============================================
-- 2. SEED MAGASINS FROM EXISTING stock_locations
-- ============================================

INSERT INTO magasins (location_id, code, nom, adresse, telephone, actif)
SELECT 
  sl.id as location_id,
  COALESCE(sl.code, 'MAG-' || sl.id) as code,
  sl.nom,
  sl.adresse,
  NULL as telephone,
  sl.actif
FROM stock_locations sl
WHERE sl.location_type = 'magasin' OR sl.est_principal = false
ON CONFLICT (code) DO NOTHING;

-- If no magasin exists yet (initial setup), create one from first non-principal location
INSERT INTO magasins (location_id, code, nom, actif)
SELECT 
  sl.id,
  'MAG01',
  COALESCE(sl.nom, 'Magasin Principal'),
  true
FROM stock_locations sl
WHERE sl.est_principal = false OR sl.location_type = 'magasin'
LIMIT 1
ON CONFLICT (code) DO NOTHING;

-- ============================================
-- 3. COMMENTS
-- ============================================

COMMENT ON TABLE magasins IS 'Store locations for cash register management - separate from stock_locations for cash concerns';
COMMENT ON COLUMN magasins.location_id IS 'Link to stock_locations for stock management integration';

-- ============================================
-- 4. VERIFY
-- ============================================

-- Show created magasins
SELECT 'Created magasins:' as info;
SELECT * FROM magasins;
