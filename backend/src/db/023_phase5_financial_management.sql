-- Migration: Phase 5C - Financial Management
-- Creates: depenses, caisses hierarchy, factures_avoir

-- ============================================================
-- 1. DÉPENSES (EXPENSES) SYSTEM
-- ============================================================

-- Expense categories
CREATE TABLE IF NOT EXISTS categories_depenses (
  id SERIAL PRIMARY KEY,
  code VARCHAR(20) UNIQUE NOT NULL,
  nom VARCHAR(100) NOT NULL,
  description TEXT,
  compte_comptable_id INTEGER REFERENCES plan_comptable(id) ON DELETE SET NULL,
  actif BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default expense categories
INSERT INTO categories_depenses (code, nom, description, compte_comptable_id) VALUES
('LOYER', 'Loyer', 'Loyer du magasin/dépôt', (SELECT id FROM plan_comptable WHERE numero = '607')),
('TRANSPORT', 'Transport', 'Frais de transport et livraison', (SELECT id FROM plan_comptable WHERE numero = '607')),
('MAINTENANCE', 'Maintenance', 'Maintenance et réparations', (SELECT id FROM plan_comptable WHERE numero = '607')),
('FOURNITURES', 'Fournitures', 'Fournitures de bureau', (SELECT id FROM plan_comptable WHERE numero = '607')),
('ELECTRICITE', 'Électricité', 'Factures d''électricité', (SELECT id FROM plan_comptable WHERE numero = '607')),
('EAU', 'Eau', 'Factures d''eau', (SELECT id FROM plan_comptable WHERE numero = '607')),
('TELEPHONE', 'Téléphone', 'Frais de téléphonie', (SELECT id FROM plan_comptable WHERE numero = '607')),
('SALAIRES', 'Salaires', 'Salaires du personnel', (SELECT id FROM plan_comptable WHERE numero = '607')),
('MARCHANDISES', 'Achats marchandises', 'Achats de marchandises', (SELECT id FROM plan_comptable WHERE numero = '601')),
('AUTRES', 'Autres dépenses', 'Dépenses diverses', (SELECT id FROM plan_comptable WHERE numero = '607'))
ON CONFLICT (code) DO NOTHING;

-- Expenses table
CREATE TABLE IF NOT EXISTS depenses (
  id SERIAL PRIMARY KEY,
  numero_depense VARCHAR(50) UNIQUE NOT NULL,
  location_id INTEGER REFERENCES stock_locations(id) ON DELETE SET NULL,
  session_caisse_id INTEGER REFERENCES sessions_caisse(id) ON DELETE SET NULL,
  categorie_id INTEGER NOT NULL REFERENCES categories_depenses(id) ON DELETE RESTRICT,
  fournisseur_id INTEGER REFERENCES fournisseurs(id) ON DELETE SET NULL,
  montant NUMERIC(15, 2) NOT NULL CHECK (montant > 0),
  methode_paiement VARCHAR(50) CHECK (methode_paiement IN ('espece', 'carte', 'cheque', 'virement')),
  date_depense DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT NOT NULL,
  justificatif_url VARCHAR(500), -- URL to receipt image
  cree_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_depenses_updated_at BEFORE UPDATE ON depenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Indexes for depenses
CREATE INDEX IF NOT EXISTS idx_depenses_location ON depenses(location_id);
CREATE INDEX IF NOT EXISTS idx_depenses_session ON depenses(session_caisse_id);
CREATE INDEX IF NOT EXISTS idx_depenses_categorie ON depenses(categorie_id);
CREATE INDEX IF NOT EXISTS idx_depenses_fournisseur ON depenses(fournisseur_id);
CREATE INDEX IF NOT EXISTS idx_depenses_date ON depenses(date_depense);
CREATE INDEX IF NOT EXISTS idx_depenses_methode ON depenses(methode_paiement);

COMMENT ON TABLE depenses IS 'Store/warehouse expenses tracking';
COMMENT ON COLUMN depenses.location_id IS 'Location where expense occurred';
COMMENT ON COLUMN depenses.session_caisse_id IS 'Linked cash session if paid from caisse';

-- ============================================================
-- 2. CAISSE PRINCIPALE (MAIN CASH REGISTER) HIERARCHY
-- ============================================================

-- Caisses (cash registers) with hierarchy
CREATE TABLE IF NOT EXISTS caisses (
  id SERIAL PRIMARY KEY,
  code VARCHAR(20) UNIQUE NOT NULL,
  nom VARCHAR(100) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('principale', 'magasin')),
  location_id INTEGER REFERENCES stock_locations(id) ON DELETE SET NULL,
  caisse_parent_id INTEGER REFERENCES caisses(id) ON DELETE SET NULL,
  solde_actuel NUMERIC(15, 2) DEFAULT 0.00,
  actif BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_caisses_updated_at BEFORE UPDATE ON caisses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Inter-caisse transfers
CREATE TABLE IF NOT EXISTS transferts_caisse (
  id SERIAL PRIMARY KEY,
  numero_transfert VARCHAR(50) UNIQUE NOT NULL,
  caisse_source_id INTEGER NOT NULL REFERENCES caisses(id) ON DELETE RESTRICT,
  caisse_dest_id INTEGER NOT NULL REFERENCES caisses(id) ON DELETE RESTRICT,
  montant NUMERIC(15, 2) NOT NULL CHECK (montant > 0),
  date_transfert TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  statut VARCHAR(20) DEFAULT 'en_attente' 
    CHECK (statut IN ('en_attente', 'valide', 'annule')),
  cree_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  valide_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  date_validation TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add caisse_id to existing sessions_caisse to link them
ALTER TABLE sessions_caisse ADD COLUMN IF NOT EXISTS caisse_id INTEGER REFERENCES caisses(id) ON DELETE SET NULL;

-- Indexes for caisses
CREATE INDEX IF NOT EXISTS idx_caisses_location ON caisses(location_id);
CREATE INDEX IF NOT EXISTS idx_caisses_parent ON caisses(caisse_parent_id);
CREATE INDEX IF NOT EXISTS idx_caisses_type ON caisses(type);
CREATE INDEX IF NOT EXISTS idx_transferts_source ON transferts_caisse(caisse_source_id);
CREATE INDEX IF NOT EXISTS idx_transferts_dest ON transferts_caisse(caisse_dest_id);
CREATE INDEX IF NOT EXISTS idx_transferts_statut ON transferts_caisse(statut);
CREATE INDEX IF NOT EXISTS idx_sessions_caisse_id ON caisses(caisse_parent_id);

COMMENT ON TABLE caisses IS 'Cash register hierarchy - principale and magasin caisses';
COMMENT ON TABLE transferts_caisse IS 'Fund transfers between caisses';

-- Create default caisses for the 3 locations
INSERT INTO caisses (code, nom, type, location_id, caisse_parent_id, solde_actuel, actif)
SELECT 
  'CAIS-PRIN',
  'Caisse Principale',
  'principale',
  (SELECT id FROM stock_locations WHERE code = 'DEPOT-01'),
  NULL,
  0.00,
  true
WHERE NOT EXISTS (SELECT 1 FROM caisses WHERE code = 'CAIS-PRIN');

INSERT INTO caisses (code, nom, type, location_id, caisse_parent_id, solde_actuel, actif)
SELECT 
  'CAIS-MAG1',
  'Caisse Magasin 1',
  'magasin',
  (SELECT id FROM stock_locations WHERE code = 'MAG-01'),
  (SELECT id FROM caisses WHERE code = 'CAIS-PRIN'),
  0.00,
  true
WHERE NOT EXISTS (SELECT 1 FROM caisses WHERE code = 'CAIS-MAG1');

INSERT INTO caisses (code, nom, type, location_id, caisse_parent_id, solde_actuel, actif)
SELECT 
  'CAIS-MAG2',
  'Caisse Magasin 2',
  'magasin',
  (SELECT id FROM stock_locations WHERE code = 'MAG-02'),
  (SELECT id FROM caisses WHERE code = 'CAIS-PRIN'),
  0.00,
  true
WHERE NOT EXISTS (SELECT 1 FROM caisses WHERE code = 'CAIS-MAG2');

-- ============================================================
-- 3. FACTURES AVOIR (CREDIT NOTES)
-- ============================================================

-- Credit notes table
CREATE TABLE IF NOT EXISTS factures_avoir (
  id SERIAL PRIMARY KEY,
  numero_avoir VARCHAR(50) UNIQUE NOT NULL,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  facture_origine_id INTEGER REFERENCES factures(id) ON DELETE SET NULL,
  retour_id INTEGER REFERENCES retours(id) ON DELETE SET NULL,
  date_avoir DATE NOT NULL DEFAULT CURRENT_DATE,
  sous_total NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  tva NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  total NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  total_ht NUMERIC(15, 2),
  total_ttc NUMERIC(15, 2),
  statut VARCHAR(20) DEFAULT 'brouillon' 
    CHECK (statut IN ('brouillon', 'valide', 'annule', 'utilise')),
  avoir_type VARCHAR(20) DEFAULT 'retour'
    CHECK (avoir_type IN ('retour', 'echange', 'remise_commerciale', 'erreur')),
  notes TEXT,
  location_id INTEGER REFERENCES stock_locations(id) ON DELETE SET NULL,
  cree_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_factures_avoir_updated_at BEFORE UPDATE ON factures_avoir
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Credit note lines
CREATE TABLE IF NOT EXISTS facture_avoir_lignes (
  id SERIAL PRIMARY KEY,
  avoir_id INTEGER NOT NULL REFERENCES factures_avoir(id) ON DELETE CASCADE,
  produit_id INTEGER REFERENCES produits(id) ON DELETE SET NULL,
  description VARCHAR(255),
  quantite INTEGER NOT NULL DEFAULT 1,
  prix_unitaire NUMERIC(15, 2) NOT NULL,
  taux_tva_id INTEGER REFERENCES taux_tva(id) ON DELETE SET NULL,
  total_ligne NUMERIC(15, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for factures_avoir
CREATE INDEX IF NOT EXISTS idx_avoir_client ON factures_avoir(client_id);
CREATE INDEX IF NOT EXISTS idx_avoir_facture ON factures_avoir(facture_origine_id);
CREATE INDEX IF NOT EXISTS idx_avoir_retour ON factures_avoir(retour_id);
CREATE INDEX IF NOT EXISTS idx_avoir_date ON factures_avoir(date_avoir);
CREATE INDEX IF NOT EXISTS idx_avoir_statut ON factures_avoir(statut);
CREATE INDEX IF NOT EXISTS idx_avoir_location ON factures_avoir(location_id);
CREATE INDEX IF NOT EXISTS idx_avoir_lignes_avoir ON facture_avoir_lignes(avoir_id);

COMMENT ON TABLE factures_avoir IS 'Credit notes issued to customers';
COMMENT ON COLUMN factures_avoir.avoir_type IS 'retour=return, echange=exchange, remise_commerciale=commercial discount, erreur=error correction';

-- ============================================================
-- 4. CREATE SEQUENCES FOR NEW DOCUMENT TYPES
-- ============================================================

-- Create PostgreSQL sequences
CREATE SEQUENCE IF NOT EXISTS depense_seq START 1;
CREATE SEQUENCE IF NOT EXISTS avoir_seq START 1;
CREATE SEQUENCE IF NOT EXISTS transfert_caisse_seq START 1;

-- Grant usage
GRANT USAGE ON SEQUENCE depense_seq TO CURRENT_USER;
GRANT USAGE ON SEQUENCE avoir_seq TO CURRENT_USER;
GRANT USAGE ON SEQUENCE transfert_caisse_seq TO CURRENT_USER;

-- ============================================================
-- 5. FUNCTIONS FOR CAISSE MANAGEMENT
-- ============================================================

-- Function to transfer funds between caisses
CREATE OR REPLACE FUNCTION transferer_fonds_caisse(
  p_caisse_source_id INTEGER,
  p_caisse_dest_id INTEGER,
  p_montant NUMERIC,
  p_user_id INTEGER,
  p_notes TEXT DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  v_transfert_id INTEGER;
  v_numero_transfert VARCHAR(50);
  v_next_val INTEGER;
  v_source_solde NUMERIC;
BEGIN
  -- Check source balance
  SELECT solde_actuel INTO v_source_solde FROM caisses WHERE id = p_caisse_source_id;
  
  IF v_source_solde < p_montant THEN
    RAISE EXCEPTION 'Insufficient funds in source caisse. Available: %, Requested: %', v_source_solde, p_montant;
  END IF;
  
  -- Generate transfer number
  SELECT COALESCE(MAX(CAST(SUBSTRING(numero_transfert FROM 4) AS INTEGER)), 0) + 1 
  INTO v_next_val FROM transferts_caisse WHERE numero_transfert LIKE 'TC-%';
  
  v_numero_transfert := 'TC-' || LPAD(v_next_val::TEXT, 6, '0');
  
  -- Create transfer record
  INSERT INTO transferts_caisse (
    numero_transfert,
    caisse_source_id,
    caisse_dest_id,
    montant,
    statut,
    cree_par,
    notes
  ) VALUES (
    v_numero_transfert,
    p_caisse_source_id,
    p_caisse_dest_id,
    p_montant,
    'valide',
    p_user_id,
    p_notes
  ) RETURNING id INTO v_transfert_id;
  
  -- Update caisse balances
  UPDATE caisses 
  SET solde_actuel = solde_actuel - p_montant 
  WHERE id = p_caisse_source_id;
  
  UPDATE caisses 
  SET solde_actuel = solde_actuel + p_montant 
  WHERE id = p_caisse_dest_id;
  
  RETURN v_transfert_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 6. FUNCTIONS FOR CREDIT NOTE GENERATION
-- ============================================================

-- Function to create credit note from return
CREATE OR REPLACE FUNCTION create_avoir_from_retour(
  p_retour_id INTEGER,
  p_user_id INTEGER
)
RETURNS INTEGER AS $$
DECLARE
  v_retour RECORD;
  v_avoir_id INTEGER;
  v_numero_avoir VARCHAR(50);
  v_next_val INTEGER;
  v_ligne RECORD;
  v_total_ht NUMERIC := 0;
  v_total_tva NUMERIC := 0;
BEGIN
  -- Get return
  SELECT * INTO v_retour FROM retours WHERE id = p_retour_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Retour % not found', p_retour_id;
  END IF;
  
  IF v_retour.statut != 'traite' THEN
    RAISE EXCEPTION 'Return must be processed before creating credit note. Current statut: %', v_retour.statut;
  END IF;
  
  -- Generate avoir number
  SELECT COALESCE(MAX(CAST(SUBSTRING(numero_avoir FROM 7) AS INTEGER)), 0) + 1 
  INTO v_next_val FROM factures_avoir WHERE numero_avoir LIKE 'AVOIR-%';
  
  v_numero_avoir := 'AVOIR-' || LPAD(v_next_val::TEXT, 6, '0');
  
  -- Calculate totals from lines
  FOR v_ligne IN SELECT * FROM retour_lignes WHERE retour_id = p_retour_id LOOP
    v_total_ht := v_total_ht + (v_ligne.quantite * v_ligne.prix_unitaire);
  END LOOP;
  
  -- Assuming 19% TVA for simplicity - should use actual taux_tva
  v_total_tva := v_total_ht * 0.19;
  
  -- Create credit note
  INSERT INTO factures_avoir (
    numero_avoir,
    client_id,
    facture_origine_id,
    retour_id,
    sous_total,
    tva,
    total,
    total_ht,
    total_ttc,
    statut,
    avoir_type,
    location_id,
    cree_par
  ) VALUES (
    v_numero_avoir,
    v_retour.client_id,
    (SELECT facture_id FROM retour_lignes WHERE retour_id = p_retour_id LIMIT 1),
    p_retour_id,
    v_total_ht,
    v_total_tva,
    v_retour.total_remboursement,
    v_total_ht,
    v_total_ht + v_total_tva,
    'valide',
    'retour',
    NULL,
    p_user_id
  ) RETURNING id INTO v_avoir_id;
  
  -- Create avoir lines from return lines
  FOR v_ligne IN SELECT * FROM retour_lignes WHERE retour_id = p_retour_id LOOP
    INSERT INTO facture_avoir_lignes (
      avoir_id,
      produit_id,
      quantite,
      prix_unitaire,
      total_ligne
    ) VALUES (
      v_avoir_id,
      v_ligne.produit_id,
      v_ligne.quantite,
      v_ligne.prix_unitaire,
      v_ligne.total_ligne
    );
  END LOOP;
  
  -- Adjust customer account
  INSERT INTO compte_client_lignes (
    client_id,
    type_operation,
    document_id,
    document_numero,
    montant_debit,
    montant_credit,
    notes,
    cree_par
  ) VALUES (
    v_retour.client_id,
    'avoir',
    v_avoir_id,
    v_numero_avoir,
    0,
    v_retour.total_remboursement,
    'Credit note from return ' || v_retour.numero_retour,
    p_user_id
  );
  
  RETURN v_avoir_id;
END;
$$ LANGUAGE plpgsql;
