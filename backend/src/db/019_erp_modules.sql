-- Migration: ERP Modules (Phase 4)
-- Includes: 3-way matching, Supplier invoices, General ledger, Multi-location, Employee management

-- ============================================================
-- 1. MULTI-LOCATION / MULTI-WAREHOUSE SUPPORT
-- ============================================================

-- Stock locations table
CREATE TABLE IF NOT EXISTS stock_locations (
  id SERIAL PRIMARY KEY,
  code VARCHAR(20) UNIQUE NOT NULL,
  nom VARCHAR(100) NOT NULL,
  adresse TEXT,
  responsable_id INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  actif BOOLEAN DEFAULT true,
  est_principal BOOLEAN DEFAULT false, -- Only one should be true
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_stock_locations_updated_at BEFORE UPDATE ON stock_locations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Stock per location (instead of single stock column in produits)
CREATE TABLE IF NOT EXISTS stock_par_location (
  id SERIAL PRIMARY KEY,
  produit_id INTEGER NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES stock_locations(id) ON DELETE CASCADE,
  quantite INTEGER NOT NULL DEFAULT 0 CHECK (quantite >= 0),
  quantite_reservee INTEGER NOT NULL DEFAULT 0 CHECK (quantite_reservee >= 0),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(produit_id, location_id)
);

CREATE TRIGGER update_stock_par_location_updated_at BEFORE UPDATE ON stock_par_location
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_stock_location_produit ON stock_par_location(produit_id);
CREATE INDEX IF NOT EXISTS idx_stock_location_location ON stock_par_location(location_id);

-- Inter-warehouse transfers
CREATE TABLE IF NOT EXISTS stock_transfers (
  id SERIAL PRIMARY KEY,
  numero_transfer VARCHAR(50) UNIQUE NOT NULL,
  location_source_id INTEGER NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
  location_destination_id INTEGER NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
  date_transfer TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  statut VARCHAR(20) DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'en_transit', 'completee', 'annulee')),
  notes TEXT,
  cree_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stock_transfer_lignes (
  id SERIAL PRIMARY KEY,
  transfer_id INTEGER NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  produit_id INTEGER NOT NULL REFERENCES produits(id) ON DELETE RESTRICT,
  quantite_demandee INTEGER NOT NULL DEFAULT 1,
  quantite_transferee INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(transfer_id, produit_id)
);

CREATE INDEX IF NOT EXISTS idx_transfer_source ON stock_transfers(location_source_id);
CREATE INDEX IF NOT EXISTS idx_transfer_destination ON stock_transfers(location_destination_id);
CREATE INDEX IF NOT EXISTS idx_transfer_statut ON stock_transfers(statut);

-- ============================================================
-- 2. SUPPLIER INVOICE MANAGEMENT (Accounts Payable)
-- ============================================================

-- Supplier invoices
CREATE TABLE IF NOT EXISTS factures_fournisseur (
  id SERIAL PRIMARY KEY,
  fournisseur_id INTEGER NOT NULL REFERENCES fournisseurs(id) ON DELETE RESTRICT,
  reception_id INTEGER REFERENCES receptions(id) ON DELETE SET NULL,
  numero_facture_fournisseur VARCHAR(100) NOT NULL, -- Supplier's invoice number
  numero_facture_interne VARCHAR(50) UNIQUE NOT NULL, -- Our internal reference
  date_facture DATE NOT NULL,
  date_echeance DATE, -- Payment due date
  sous_total NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  tva NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  total NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  montant_paye NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  reste_due NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  statut VARCHAR(20) DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'validee', 'partiellement_payee', 'payee', 'annulee')),
  condition_paiement VARCHAR(50), -- e.g., '30 jours', '60 jours fin de mois'
  notes TEXT,
  cree_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(fournisseur_id, numero_facture_fournisseur)
);

CREATE TRIGGER update_factures_fournisseur_updated_at BEFORE UPDATE ON factures_fournisseur
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Supplier invoice line items
CREATE TABLE IF NOT EXISTS facture_fournisseur_lignes (
  id SERIAL PRIMARY KEY,
  facture_id INTEGER NOT NULL REFERENCES factures_fournisseur(id) ON DELETE CASCADE,
  produit_id INTEGER REFERENCES produits(id) ON DELETE SET NULL,
  description VARCHAR(255), -- For non-product items
  quantite INTEGER NOT NULL DEFAULT 1,
  prix_unitaire NUMERIC(15, 2) NOT NULL,
  tva_taux NUMERIC(5, 2) DEFAULT 0.00,
  total_ligne NUMERIC(15, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Supplier payments (outgoing)
CREATE TABLE IF NOT EXISTS paiements_fournisseur (
  id SERIAL PRIMARY KEY,
  facture_id INTEGER NOT NULL REFERENCES factures_fournisseur(id) ON DELETE CASCADE,
  montant NUMERIC(15, 2) NOT NULL,
  methode_paiement VARCHAR(50) NOT NULL CHECK (methode_paiement IN ('espece', 'carte', 'cheque', 'virement')),
  date_paiement TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reference VARCHAR(100),
  notes TEXT,
  effectue_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ff_fournisseur ON factures_fournisseur(fournisseur_id);
CREATE INDEX IF NOT EXISTS idx_ff_date ON factures_fournisseur(date_facture);
CREATE INDEX IF NOT EXISTS idx_ff_statut ON factures_fournisseur(statut);
CREATE INDEX IF NOT EXISTS idx_ff_echeance ON factures_fournisseur(date_echeance);
CREATE INDEX IF NOT EXISTS idx_ff_reception ON factures_fournisseur(reception_id);
CREATE INDEX IF NOT EXISTS idx_paiement_ff_facture ON paiements_fournisseur(facture_id);

-- Trigger for supplier invoice payment status
CREATE OR REPLACE FUNCTION update_facture_fournisseur_payment_status()
RETURNS TRIGGER AS $$
DECLARE
  total_due NUMERIC(15, 2);
  total_paid NUMERIC(15, 2);
BEGIN
  SELECT total INTO total_due FROM factures_fournisseur WHERE id = NEW.facture_id;
  SELECT COALESCE(SUM(montant), 0) INTO total_paid
  FROM paiements_fournisseur
  WHERE facture_id = NEW.facture_id;

  UPDATE factures_fournisseur
  SET
    montant_paye = total_paid,
    reste_due = total_due - total_paid,
    statut = CASE
      WHEN total_paid = 0 THEN 'en_attente'
      WHEN total_paid < total_due THEN 'partiellement_payee'
      WHEN total_paid >= total_due THEN 'payee'
    END
  WHERE id = NEW.facture_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_after_paiement_ff_insert ON paiements_fournisseur;
CREATE TRIGGER trg_after_paiement_ff_insert
  AFTER INSERT ON paiements_fournisseur
  FOR EACH ROW
  EXECUTE FUNCTION update_facture_fournisseur_payment_status();

-- ============================================================
-- 3. GENERAL LEDGER / ACCOUNTING INTEGRATION
-- ============================================================

-- Chart of accounts (Plan comptable simplifié)
CREATE TABLE IF NOT EXISTS plan_comptable (
  id SERIAL PRIMARY KEY,
  numero VARCHAR(20) UNIQUE NOT NULL,
  intitule VARCHAR(255) NOT NULL,
  type_compte VARCHAR(50) NOT NULL CHECK (type_compte IN ('actif', 'passif', 'capitaux_propres', 'charge', 'produit')),
  categorie VARCHAR(50), -- 'classe1', 'classe2', etc.
  actif BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default chart of accounts
INSERT INTO plan_comptable (numero, intitule, type_compte, categorie) VALUES
('101', 'Capital social', 'capitaux_propres', 'classe1'),
('401', 'Fournisseurs', 'passif', 'classe4'),
('411', 'Clients', 'actif', 'classe4'),
('419', 'Clients - Avances et acomptes', 'actif', 'classe4'),
('512', 'Banque', 'actif', 'classe5'),
('530', 'Caisse', 'actif', 'classe5'),
('601', 'Achats de marchandises', 'charge', 'classe6'),
('607', 'Achats de matières premières', 'charge', 'classe6'),
('701', 'Ventes de marchandises', 'produit', 'classe7'),
('4456', 'TVA déductible', 'actif', 'classe4'),
('4457', 'TVA collectée', 'passif', 'classe4'),
('44551', 'TVA sur achats', 'actif', 'classe4'),
('44552', 'TVA sur ventes', 'passif', 'classe4')
ON CONFLICT (numero) DO NOTHING;

-- Journal entries (Écritures comptables)
CREATE TABLE IF NOT EXISTS ecritures_comptables (
  id SERIAL PRIMARY KEY,
  numero_piece VARCHAR(50),
  date_ecriture TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  journal VARCHAR(20) NOT NULL CHECK (journal IN ('ACHATS', 'VENTES', 'TRESORERIE', 'OD')), -- OD = Opérations Diverses
  piece_id INTEGER, -- Reference to originating document
  piece_type VARCHAR(50), -- 'facture', 'facture_fournisseur', 'paiement', 'session_caisse', 'reception'
  ligne_numero INTEGER NOT NULL,
  compte_id INTEGER NOT NULL REFERENCES plan_comptable(id) ON DELETE RESTRICT,
  debit NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (debit >= 0),
  credit NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (credit >= 0),
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ensure balanced journal entries
CREATE INDEX IF NOT EXISTS idx_ecriture_date ON ecritures_comptables(date_ecriture);
CREATE INDEX IF NOT EXISTS idx_ecriture_journal ON ecritures_comptables(journal);
CREATE INDEX IF NOT EXISTS idx_ecriture_compte ON ecritures_comptables(compte_id);
CREATE INDEX IF NOT EXISTS idx_ecriture_piece ON ecritures_comptables(piece_type, piece_id);

-- Accounting periods
CREATE TABLE IF NOT EXISTS periodes_comptables (
  id SERIAL PRIMARY KEY,
  exercice INTEGER NOT NULL,
  periode INTEGER NOT NULL CHECK (periode BETWEEN 1 AND 12),
  date_debut DATE NOT NULL,
  date_fin DATE NOT NULL,
  statut VARCHAR(20) DEFAULT 'ouverte' CHECK (statut IN ('ouverte', 'fermee')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(exercice, periode)
);

-- ============================================================
-- 4. EMPLOYEE MANAGEMENT & COMMISSION
-- ============================================================

-- Employee profiles
CREATE TABLE IF NOT EXISTS employes (
  id SERIAL PRIMARY KEY,
  utilisateur_id INTEGER UNIQUE REFERENCES utilisateurs(id) ON DELETE CASCADE,
  matricule VARCHAR(50) UNIQUE NOT NULL,
  nom_complet VARCHAR(255) NOT NULL,
  poste VARCHAR(100),
  departement VARCHAR(100),
  date_embauche DATE NOT NULL,
  date_naissance DATE,
  telephone VARCHAR(20),
  email VARCHAR(255),
  adresse TEXT,
  salaire_base NUMERIC(15, 2),
  commission_taux NUMERIC(5, 2) DEFAULT 0.00, -- Commission percentage
  actif BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_employes_updated_at BEFORE UPDATE ON employes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Sales commissions tracking
CREATE TABLE IF NOT EXISTS commissions_ventes (
  id SERIAL PRIMARY KEY,
  employe_id INTEGER NOT NULL REFERENCES employes(id) ON DELETE RESTRICT,
  facture_id INTEGER NOT NULL REFERENCES factures(id) ON DELETE CASCADE,
  montant_vente NUMERIC(15, 2) NOT NULL,
  taux_commission NUMERIC(5, 2) NOT NULL,
  montant_commission NUMERIC(15, 2) NOT NULL,
  date_vente DATE NOT NULL,
  statut VARCHAR(20) DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'validee', 'payee')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Attendance/Shifts
CREATE TABLE IF NOT EXISTS shifts_employes (
  id SERIAL PRIMARY KEY,
  employe_id INTEGER NOT NULL REFERENCES employes(id) ON DELETE CASCADE,
  date_shift DATE NOT NULL,
  heure_prevue_debut TIME,
  heure_prevue_fin TIME,
  heure_debut TIME,
  heure_fin TIME,
  statut VARCHAR(20) DEFAULT 'prevu' CHECK (statut IN ('prevu', 'en_cours', 'termine', 'absent')),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_employes_matricule ON employes(matricule);
CREATE INDEX IF NOT EXISTS idx_employes_utilisateur ON employes(utilisateur_id);
CREATE INDEX IF NOT EXISTS idx_employes_actif ON employes(actif);
CREATE INDEX IF NOT EXISTS idx_commissions_employe ON commissions_ventes(employe_id);
CREATE INDEX IF NOT EXISTS idx_commissions_facture ON commissions_ventes(facture_id);
CREATE INDEX IF NOT EXISTS idx_shifts_employe ON shifts_employes(employe_id);
CREATE INDEX IF NOT EXISTS idx_shifts_date ON shifts_employes(date_shift);

-- ============================================================
-- 5. PURCHASE ORDER TO RECEPTION 3-WAY MATCHING
-- ============================================================

-- 3-way match validation records
CREATE TABLE IF NOT EXISTS three_way_matches (
  id SERIAL PRIMARY KEY,
  commande_id INTEGER NOT NULL REFERENCES commandes_fournisseur(id) ON DELETE RESTRICT,
  reception_id INTEGER NOT NULL REFERENCES receptions(id) ON DELETE RESTRICT,
  facture_fournisseur_id INTEGER REFERENCES factures_fournisseur(id) ON DELETE SET NULL,
  date_verification TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  statut VARCHAR(20) DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'valide', 'ecart_identifie', 'rejete')),
  ecart_quantite INTEGER DEFAULT 0,
  ecart_prix NUMERIC(15, 2) DEFAULT 0.00,
  notes TEXT,
  valide_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(commande_id, reception_id)
);

-- Discrepancy tracking
CREATE TABLE IF NOT EXISTS three_way_match_details (
  id SERIAL PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES three_way_matches(id) ON DELETE CASCADE,
  produit_id INTEGER NOT NULL REFERENCES produits(id) ON DELETE RESTRICT,
  quantite_commandee INTEGER NOT NULL,
  quantite_recue INTEGER NOT NULL,
  prix_commande NUMERIC(15, 2) NOT NULL,
  prix_facture NUMERIC(15, 2) NOT NULL,
  ecart_quantite INTEGER DEFAULT 0,
  ecart_prix NUMERIC(15, 2) DEFAULT 0.00,
  commentaire TEXT
);

CREATE INDEX IF NOT EXISTS idx_3wm_commande ON three_way_matches(commande_id);
CREATE INDEX IF NOT EXISTS idx_3wm_reception ON three_way_matches(reception_id);
CREATE INDEX IF NOT EXISTS idx_3wm_facture ON three_way_matches(facture_fournisseur_id);
CREATE INDEX IF NOT EXISTS idx_3wm_statut ON three_way_matches(statut);

-- ============================================================
-- 6. UPDATE EXISTING STOCK MOVEMENTS TO INCLUDE LOCATION
-- ============================================================

-- Add location tracking to existing mouvements_stock
ALTER TABLE mouvements_stock ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES stock_locations(id) ON DELETE SET NULL;
ALTER TABLE mouvements_stock ADD COLUMN IF NOT EXISTS transfer_id INTEGER REFERENCES stock_transfers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_mouvements_location ON mouvements_stock(location_id);

-- ============================================================
-- 7. AUTOMATED ACCOUNTING TRIGGERS
-- ============================================================

-- Ensure required chart-of-account rows exist and return their IDs.
CREATE OR REPLACE FUNCTION ensure_plan_compte(
  p_numero VARCHAR(20),
  p_intitule VARCHAR(255),
  p_type_compte VARCHAR(50),
  p_categorie VARCHAR(50)
)
RETURNS INTEGER AS $$
DECLARE
  v_compte_id INTEGER;
BEGIN
  SELECT id INTO v_compte_id
  FROM plan_comptable
  WHERE numero = p_numero;

  IF v_compte_id IS NULL THEN
    INSERT INTO plan_comptable (numero, intitule, type_compte, categorie)
    VALUES (p_numero, p_intitule, p_type_compte, p_categorie)
    ON CONFLICT (numero) DO UPDATE
      SET intitule = EXCLUDED.intitule,
          type_compte = EXCLUDED.type_compte,
          categorie = EXCLUDED.categorie
    RETURNING id INTO v_compte_id;
  END IF;

  RETURN v_compte_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger to create journal entries on supplier invoice creation
CREATE OR REPLACE FUNCTION create_ecritures_facture_fournisseur()
RETURNS TRIGGER AS $$
DECLARE
  compte_achat_id INTEGER;
  compte_tva_id INTEGER;
  compte_fournisseur_id INTEGER;
BEGIN
  -- Get account IDs
  compte_achat_id := ensure_plan_compte('601', 'Achats de marchandises', 'charge', 'classe6');
  compte_tva_id := ensure_plan_compte('4456', 'TVA déductible', 'actif', 'classe4');
  compte_fournisseur_id := ensure_plan_compte('401', 'Fournisseurs', 'passif', 'classe4');

  -- Debit: Purchase expense
  INSERT INTO ecritures_comptables (numero_piece, date_ecriture, journal, piece_id, piece_type, ligne_numero, compte_id, debit, credit, description)
  VALUES (NEW.numero_facture_interne, NEW.date_facture, 'ACHATS', NEW.id, 'facture_fournisseur', 1, compte_achat_id, NEW.sous_total, 0, 'Achat marchandises - ' || NEW.numero_facture_fournisseur);

  -- Debit: VAT deductible
  IF NEW.tva > 0 THEN
    INSERT INTO ecritures_comptables (numero_piece, date_ecriture, journal, piece_id, piece_type, ligne_numero, compte_id, debit, credit, description)
    VALUES (NEW.numero_facture_interne, NEW.date_facture, 'ACHATS', NEW.id, 'facture_fournisseur', 2, compte_tva_id, NEW.tva, 0, 'TVA déductible - ' || NEW.numero_facture_fournisseur);
  END IF;

  -- Credit: Supplier payable
  INSERT INTO ecritures_comptables (numero_piece, date_ecriture, journal, piece_id, piece_type, ligne_numero, compte_id, debit, credit, description)
  VALUES (NEW.numero_facture_interne, NEW.date_facture, 'ACHATS', NEW.id, 'facture_fournisseur', 3, compte_fournisseur_id, 0, NEW.total, 'Dette fournisseur - ' || NEW.numero_facture_fournisseur);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_facture_fournisseur_ecriture ON factures_fournisseur;
CREATE TRIGGER trg_facture_fournisseur_ecriture
  AFTER INSERT ON factures_fournisseur
  FOR EACH ROW
  EXECUTE FUNCTION create_ecritures_facture_fournisseur();

-- Trigger to create journal entries on customer invoice creation
CREATE OR REPLACE FUNCTION create_ecritures_facture_client()
RETURNS TRIGGER AS $$
DECLARE
  compte_vente_id INTEGER;
  compte_tva_id INTEGER;
  compte_client_id INTEGER;
BEGIN
  -- Get account IDs
  compte_vente_id := ensure_plan_compte('701', 'Ventes de marchandises', 'produit', 'classe7');
  compte_tva_id := ensure_plan_compte('4457', 'TVA collectée', 'passif', 'classe4');
  compte_client_id := ensure_plan_compte('411', 'Clients', 'actif', 'classe4');

  -- Debit: Customer receivable
  INSERT INTO ecritures_comptables (numero_piece, date_ecriture, journal, piece_id, piece_type, ligne_numero, compte_id, debit, credit, description)
  VALUES (NEW.numero_facture, NEW.date_facture, 'VENTES', NEW.id, 'facture', 1, compte_client_id, NEW.total, 0, 'Vente client - ' || NEW.numero_facture);

  -- Credit: Sales revenue
  INSERT INTO ecritures_comptables (numero_piece, date_ecriture, journal, piece_id, piece_type, ligne_numero, compte_id, debit, credit, description)
  VALUES (NEW.numero_facture, NEW.date_facture, 'VENTES', NEW.id, 'facture', 2, compte_vente_id, 0, NEW.sous_total, 'Chiffre d''affaires - ' || NEW.numero_facture);

  -- Credit: VAT collected
  IF NEW.tva > 0 THEN
    INSERT INTO ecritures_comptables (numero_piece, date_ecriture, journal, piece_id, piece_type, ligne_numero, compte_id, debit, credit, description)
    VALUES (NEW.numero_facture, NEW.date_facture, 'VENTES', NEW.id, 'facture', 3, compte_tva_id, 0, NEW.tva, 'TVA collectée - ' || NEW.numero_facture);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_facture_client_ecriture ON factures;
CREATE TRIGGER trg_facture_client_ecriture
  AFTER INSERT ON factures
  FOR EACH ROW
  EXECUTE FUNCTION create_ecritures_facture_client();

-- ============================================================
-- 8. INSERT DEFAULT MAIN LOCATION
-- ============================================================

INSERT INTO stock_locations (code, nom, est_principal) VALUES
('MAIN', 'Magasin Principal', true)
ON CONFLICT (code) DO NOTHING;
