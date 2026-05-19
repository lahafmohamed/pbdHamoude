-- Migration: Phase 5B - Devis, Bon de Livraison, and Location Setup
-- Creates: devis tables, bons_livraison tables, depot/magasin locations

-- ============================================================
-- 1. DEVIS (QUOTES) SYSTEM
-- ============================================================

-- Devis header
CREATE TABLE IF NOT EXISTS devis (
  id SERIAL PRIMARY KEY,
  numero_devis VARCHAR(50) UNIQUE NOT NULL,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  date_devis DATE NOT NULL DEFAULT CURRENT_DATE,
  date_validite DATE, -- Quote expiration date
  statut VARCHAR(20) DEFAULT 'brouillon' 
    CHECK (statut IN ('brouillon', 'envoye', 'accepte', 'refuse', 'annule', 'converti')),
  sous_total NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  remise_globale NUMERIC(15, 2) DEFAULT 0.00,
  remise_globale_pct NUMERIC(5, 2) DEFAULT 0.00,
  tva NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  total NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  total_ht NUMERIC(15, 2),
  total_ttc NUMERIC(15, 2),
  notes TEXT,
  conditions TEXT,
  location_id INTEGER REFERENCES stock_locations(id) ON DELETE SET NULL,
  facture_id INTEGER REFERENCES factures(id) ON DELETE SET NULL, -- Linked invoice if converted
  cree_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_devis_updated_at BEFORE UPDATE ON devis
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Devis lines
CREATE TABLE IF NOT EXISTS devis_lignes (
  id SERIAL PRIMARY KEY,
  devis_id INTEGER NOT NULL REFERENCES devis(id) ON DELETE CASCADE,
  produit_id INTEGER REFERENCES produits(id) ON DELETE SET NULL,
  description VARCHAR(255), -- For custom items
  quantite INTEGER NOT NULL DEFAULT 1 CHECK (quantite > 0),
  prix_unitaire NUMERIC(15, 2) NOT NULL,
  remise_pct NUMERIC(5, 2) DEFAULT 0.00,
  remise_montant NUMERIC(15, 2) DEFAULT 0.00,
  total_ligne NUMERIC(15, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for devis
CREATE INDEX IF NOT EXISTS idx_devis_client ON devis(client_id);
CREATE INDEX IF NOT EXISTS idx_devis_date ON devis(date_devis);
CREATE INDEX IF NOT EXISTS idx_devis_statut ON devis(statut);
CREATE INDEX IF NOT EXISTS idx_devis_location ON devis(location_id);
CREATE INDEX IF NOT EXISTS idx_devis_facture ON devis(facture_id);
CREATE INDEX IF NOT EXISTS idx_devis_lignes_devis ON devis_lignes(devis_id);
CREATE INDEX IF NOT EXISTS idx_devis_lignes_produit ON devis_lignes(produit_id);

COMMENT ON TABLE devis IS 'Customer quotes';
COMMENT ON COLUMN devis.statut IS 'brouillon=draft, envoye=sent, accepte=accepted, refuse=refused, annule=cancelled, converti=converted';

-- ============================================================
-- 2. BONS DE LIVRAISON (DELIVERY NOTES)
-- ============================================================

-- Bon de livraison header
CREATE TABLE IF NOT EXISTS bons_livraison (
  id SERIAL PRIMARY KEY,
  numero_bl VARCHAR(50) UNIQUE NOT NULL,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  devis_id INTEGER REFERENCES devis(id) ON DELETE SET NULL,
  date_bl DATE NOT NULL DEFAULT CURRENT_DATE,
  statut VARCHAR(20) DEFAULT 'brouillon' 
    CHECK (statut IN ('brouillon', 'valide', 'livre', 'facture', 'annule')),
  facture_id INTEGER REFERENCES factures(id) ON DELETE SET NULL,
  sous_total NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  tva NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  total NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  notes TEXT,
  adresse_livraison TEXT,
  date_livraison_prevue DATE,
  location_id INTEGER REFERENCES stock_locations(id) ON DELETE SET NULL,
  cree_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_bons_livraison_updated_at BEFORE UPDATE ON bons_livraison
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Bon de livraison lines
CREATE TABLE IF NOT EXISTS bon_livraison_lignes (
  id SERIAL PRIMARY KEY,
  bl_id INTEGER NOT NULL REFERENCES bons_livraison(id) ON DELETE CASCADE,
  produit_id INTEGER REFERENCES produits(id) ON DELETE SET NULL,
  description VARCHAR(255),
  quantite_commandee INTEGER NOT NULL DEFAULT 1 CHECK (quantite_commandee > 0),
  quantite_livree INTEGER NOT NULL DEFAULT 1 CHECK (quantite_livree > 0),
  prix_unitaire NUMERIC(15, 2) NOT NULL,
  total_ligne NUMERIC(15, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for bons_livraison
CREATE INDEX IF NOT EXISTS idx_bl_client ON bons_livraison(client_id);
CREATE INDEX IF NOT EXISTS idx_bl_date ON bons_livraison(date_bl);
CREATE INDEX IF NOT EXISTS idx_bl_statut ON bons_livraison(statut);
CREATE INDEX IF NOT EXISTS idx_bl_devis ON bons_livraison(devis_id);
CREATE INDEX IF NOT EXISTS idx_bl_facture ON bons_livraison(facture_id);
CREATE INDEX IF NOT EXISTS idx_bl_location ON bons_livraison(location_id);
CREATE INDEX IF NOT EXISTS idx_bl_lignes_bl ON bon_livraison_lignes(bl_id);
CREATE INDEX IF NOT EXISTS idx_bl_lignes_produit ON bon_livraison_lignes(produit_id);

COMMENT ON TABLE bons_livraison IS 'Delivery notes';
COMMENT ON COLUMN bons_livraison.statut IS 'brouillon=draft, valide=validated, livre=delivered, facture=invoiced, annule=cancelled';

-- ============================================================
-- 3. CREATE SEQUENCES FOR NEW DOCUMENT TYPES
-- ============================================================

-- Create PostgreSQL sequences
CREATE SEQUENCE IF NOT EXISTS devis_seq START 1;
CREATE SEQUENCE IF NOT EXISTS bl_seq START 1;

-- Grant usage
GRANT USAGE ON SEQUENCE devis_seq TO CURRENT_USER;
GRANT USAGE ON SEQUENCE bl_seq TO CURRENT_USER;

-- ============================================================
-- 4. CREATE DEPOT AND MAGASIN LOCATIONS
-- ============================================================

-- Clear the default MAIN location if it exists and we're creating proper ones
DELETE FROM stock_locations WHERE code = 'MAIN';

-- Insert depot (warehouse)
INSERT INTO stock_locations (code, nom, adresse, actif, est_principal) 
VALUES 
  ('DEPOT-01', 'Dépôt Principal', 'Zone de stockage principale', true, true)
ON CONFLICT (code) DO NOTHING;

-- Insert 2 magasins (retail stores)
INSERT INTO stock_locations (code, nom, adresse, actif, est_principal) 
VALUES 
  ('MAG-01', 'Magasin 1', 'Premier point de vente', true, false),
  ('MAG-02', 'Magasin 2', 'Deuxième point de vente', true, false)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 5. ADD LOCATION TO DEVIS AND BL WORKFLOW
-- ============================================================

-- Function to convert devis to facture
CREATE OR REPLACE FUNCTION convert_devis_to_facture(p_devis_id INTEGER, p_user_id INTEGER)
RETURNS INTEGER AS $$
DECLARE
  v_devis RECORD;
  v_facture_id INTEGER;
  v_numero_facture VARCHAR(50);
  v_ligne RECORD;
  v_next_val INTEGER;
BEGIN
  -- Get devis
  SELECT * INTO v_devis FROM devis WHERE id = p_devis_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devis % not found', p_devis_id;
  END IF;
  
  IF v_devis.statut != 'accepte' THEN
    RAISE EXCEPTION 'Devis must be accepted before conversion. Current statut: %', v_devis.statut;
  END IF;
  
  -- Generate invoice number from FAC-##### or FAC-YYYY-##### formats.
  SELECT COALESCE(
    MAX((regexp_match(numero_facture, '^FAC-(?:[0-9]{4}-)?([0-9]+)$'))[1]::INTEGER),
    0
  ) + 1
  INTO v_next_val
  FROM factures
  WHERE numero_facture ~ '^FAC-(?:[0-9]{4}-)?[0-9]+$';
  
  v_numero_facture := 'FAC-' || LPAD(v_next_val::TEXT, 6, '0');
  
  -- Create facture
  INSERT INTO factures (
    numero_facture,
    client_id,
    date_facture,
    sous_total,
    tva,
    total,
    notes,
    location_id,
    delai_paiement,
    hors_taxe
  ) VALUES (
    v_numero_facture,
    v_devis.client_id,
    CURRENT_TIMESTAMP,
    v_devis.sous_total,
    v_devis.tva,
    v_devis.total,
    v_devis.notes,
    v_devis.location_id,
    'net_30', -- Default payment terms
    false
  ) RETURNING id INTO v_facture_id;
  
  -- Create facture lines
  FOR v_ligne IN
    SELECT * FROM document_lignes
    WHERE document_type = 'devis' AND document_id = p_devis_id
  LOOP
    INSERT INTO document_lignes (
      document_type,
      document_id,
      produit_id,
      description,
      quantite,
      prix_unitaire,
      total_ligne,
      parent_ligne_id
    ) VALUES (
      'facture',
      v_facture_id,
      v_ligne.produit_id,
      v_ligne.description,
      v_ligne.quantite,
      v_ligne.prix_unitaire,
      v_ligne.total_ligne,
      v_ligne.id
    );
  END LOOP;
  
  -- Update devis statut
  UPDATE devis SET statut = 'converti', facture_id = v_facture_id WHERE id = p_devis_id;
  
  RETURN v_facture_id;
END;
$$ LANGUAGE plpgsql;

-- Function to convert devis to bon de livraison
CREATE OR REPLACE FUNCTION convert_devis_to_bl(p_devis_id INTEGER, p_user_id INTEGER)
RETURNS INTEGER AS $$
DECLARE
  v_devis RECORD;
  v_bl_id INTEGER;
  v_numero_bl VARCHAR(50);
  v_ligne RECORD;
  v_next_val INTEGER;
BEGIN
  -- Get devis
  SELECT * INTO v_devis FROM devis WHERE id = p_devis_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devis % not found', p_devis_id;
  END IF;
  
  -- Generate BL number
  SELECT COALESCE(MAX(CAST(SUBSTRING(numero_bl FROM 4) AS INTEGER)), 0) + 1 
  INTO v_next_val FROM bons_livraison WHERE numero_bl LIKE 'BL-%';
  
  v_numero_bl := 'BL-' || LPAD(v_next_val::TEXT, 6, '0');
  
  -- Create bon de livraison
  INSERT INTO bons_livraison (
    numero_bl,
    client_id,
    devis_id,
    date_bl,
    sous_total,
    tva,
    total,
    notes,
    location_id,
    cree_par
  ) VALUES (
    v_numero_bl,
    v_devis.client_id,
    p_devis_id,
    CURRENT_DATE,
    v_devis.sous_total,
    v_devis.tva,
    v_devis.total,
    v_devis.notes,
    v_devis.location_id,
    p_user_id
  ) RETURNING id INTO v_bl_id;
  
  -- Create BL lines
  FOR v_ligne IN
    SELECT * FROM document_lignes
    WHERE document_type = 'devis' AND document_id = p_devis_id
  LOOP
    INSERT INTO document_lignes (
      document_type,
      document_id,
      produit_id,
      description,
      quantite,
      quantite_livree,
      prix_unitaire,
      total_ligne,
      parent_ligne_id
    ) VALUES (
      'bl',
      v_bl_id,
      v_ligne.produit_id,
      v_ligne.description,
      v_ligne.quantite,
      v_ligne.quantite,
      v_ligne.prix_unitaire,
      v_ligne.total_ligne,
      v_ligne.id
    );
  END LOOP;
  
  -- Update devis statut
  UPDATE devis SET statut = 'accepte' WHERE id = p_devis_id;
  
  RETURN v_bl_id;
END;
$$ LANGUAGE plpgsql;

-- Function to convert BL to facture
CREATE OR REPLACE FUNCTION convert_bl_to_facture(p_bl_id INTEGER, p_user_id INTEGER)
RETURNS INTEGER AS $$
DECLARE
  v_bl RECORD;
  v_facture_id INTEGER;
  v_numero_facture VARCHAR(50);
  v_ligne RECORD;
  v_next_val INTEGER;
BEGIN
  -- Get BL
  SELECT * INTO v_bl FROM bons_livraison WHERE id = p_bl_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bon de livraison % not found', p_bl_id;
  END IF;
  
  -- Generate invoice number from FAC-##### or FAC-YYYY-##### formats.
  SELECT COALESCE(
    MAX((regexp_match(numero_facture, '^FAC-(?:[0-9]{4}-)?([0-9]+)$'))[1]::INTEGER),
    0
  ) + 1
  INTO v_next_val
  FROM factures
  WHERE numero_facture ~ '^FAC-(?:[0-9]{4}-)?[0-9]+$';
  
  v_numero_facture := 'FAC-' || LPAD(v_next_val::TEXT, 6, '0');
  
  -- Create facture
  INSERT INTO factures (
    numero_facture,
    client_id,
    date_facture,
    sous_total,
    tva,
    total,
    montant_paye,
    remaining_due,
    statut,
    notes,
    location_id
  ) VALUES (
    v_numero_facture,
    v_bl.client_id,
    CURRENT_TIMESTAMP,
    v_bl.sous_total,
    v_bl.tva,
    v_bl.total,
    0,
    v_bl.total,
    'en_attente',
    v_bl.notes,
    v_bl.location_id
  ) RETURNING id INTO v_facture_id;
  
  -- Create facture lines
  FOR v_ligne IN
    SELECT * FROM document_lignes
    WHERE document_type = 'bl' AND document_id = p_bl_id
  LOOP
    INSERT INTO document_lignes (
      document_type,
      document_id,
      produit_id,
      description,
      quantite,
      prix_unitaire,
      total_ligne,
      parent_ligne_id
    ) VALUES (
      'facture',
      v_facture_id,
      v_ligne.produit_id,
      v_ligne.description,
      v_ligne.quantite,
      v_ligne.prix_unitaire,
      v_ligne.total_ligne,
      v_ligne.id
    );
  END LOOP;
  
  -- Update BL statut
  UPDATE bons_livraison SET statut = 'facture', facture_id = v_facture_id WHERE id = p_bl_id;
  
  RETURN v_facture_id;
END;
$$ LANGUAGE plpgsql;
