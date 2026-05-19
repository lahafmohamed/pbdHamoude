-- Migration 039: Camions Gasoil module
-- Track company trucks and fuel consumption

CREATE SEQUENCE IF NOT EXISTS camion_seq START 1;
CREATE SEQUENCE IF NOT EXISTS ravitaillement_seq START 1;

-- ============================================================
-- CAMIONS (fleet registry)
-- ============================================================

CREATE TABLE IF NOT EXISTS camions (
  id SERIAL PRIMARY KEY,
  code VARCHAR(20) UNIQUE NOT NULL,
  plaque VARCHAR(20) UNIQUE NOT NULL,
  marque VARCHAR(100),
  modele VARCHAR(100),
  annee INTEGER,
  capacite_charge_kg NUMERIC(10, 2),
  kilometrage_actuel INTEGER NOT NULL DEFAULT 0,
  chauffeur_id INTEGER REFERENCES employes(id) ON DELETE SET NULL,
  location_id INTEGER REFERENCES stock_locations(id) ON DELETE SET NULL,
  actif BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  cree_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_camions_updated_at BEFORE UPDATE ON camions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_camions_actif ON camions(actif);
CREATE INDEX IF NOT EXISTS idx_camions_chauffeur ON camions(chauffeur_id);

-- ============================================================
-- RAVITAILLEMENTS_CARBURANT (fuel fill records)
-- ============================================================

CREATE TABLE IF NOT EXISTS ravitaillements_carburant (
  id SERIAL PRIMARY KEY,
  numero_ravitaillement VARCHAR(50) UNIQUE NOT NULL,
  camion_id INTEGER NOT NULL REFERENCES camions(id) ON DELETE RESTRICT,
  date_ravitaillement DATE NOT NULL DEFAULT CURRENT_DATE,
  volume_litres NUMERIC(10, 2) NOT NULL CHECK (volume_litres > 0),
  prix_litre NUMERIC(10, 2) NOT NULL CHECK (prix_litre > 0),
  cout_total NUMERIC(15, 2) GENERATED ALWAYS AS (volume_litres * prix_litre) STORED,
  kilometrage_depart INTEGER,
  kilometrage_arrive INTEGER,
  distance_km INTEGER GENERATED ALWAYS AS (
    CASE WHEN kilometrage_arrive IS NOT NULL AND kilometrage_depart IS NOT NULL
         THEN kilometrage_arrive - kilometrage_depart
         ELSE NULL END
  ) STORED,
  station_service VARCHAR(100),
  fournisseur_id INTEGER REFERENCES fournisseurs(id) ON DELETE SET NULL,
  depense_id INTEGER REFERENCES depenses(id) ON DELETE SET NULL,
  notes TEXT,
  cree_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_ravitaillements_updated_at BEFORE UPDATE ON ravitaillements_carburant
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_ravit_camion ON ravitaillements_carburant(camion_id);
CREATE INDEX IF NOT EXISTS idx_ravit_date ON ravitaillements_carburant(date_ravitaillement);
CREATE INDEX IF NOT EXISTS idx_ravit_fournisseur ON ravitaillements_carburant(fournisseur_id);

-- Trigger: update camions.kilometrage_actuel on new fill
CREATE OR REPLACE FUNCTION sync_camion_kilometrage()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.kilometrage_arrive IS NOT NULL THEN
    UPDATE camions SET kilometrage_actuel = NEW.kilometrage_arrive
    WHERE id = NEW.camion_id AND kilometrage_actuel < NEW.kilometrage_arrive;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_kilometrage
  AFTER INSERT OR UPDATE ON ravitaillements_carburant
  FOR EACH ROW EXECUTE FUNCTION sync_camion_kilometrage();
