-- Migration 043: Unified Tiers Model
-- Replaces separate clients/fournisseurs tables with a single tiers table.
-- A tiers can be est_client=true AND/OR est_fournisseur=true simultaneously.
-- Run on a fresh database (test data discarded).

-- ============================================================
-- 1. DROP OLD DEPENDENT OBJECTS (cascade order)
-- ============================================================

-- Drop views that reference clients/fournisseurs
DROP VIEW IF EXISTS vue_solde_clients CASCADE;
DROP VIEW IF EXISTS vue_acomptes_disponibles CASCADE;
DROP VIEW IF EXISTS actifs_clients CASCADE;
DROP VIEW IF EXISTS actifs_fournisseurs CASCADE;
DROP VIEW IF EXISTS actifs_commandes CASCADE;
DROP VIEW IF EXISTS actifs_produits CASCADE;
DROP VIEW IF EXISTS actifs_factures CASCADE;
DROP VIEW IF EXISTS lots_perimion CASCADE;
DROP VIEW IF EXISTS articles_sous_garantie CASCADE;
DROP TABLE IF EXISTS reorder_suggestions CASCADE;

-- Drop triggers on old tables
DROP TRIGGER IF EXISTS update_clients_updated_at ON clients;
DROP TRIGGER IF EXISTS update_fournisseurs_updated_at ON fournisseurs;
DROP TRIGGER IF EXISTS trigger_update_client_solde ON compte_client_lignes;
DROP TRIGGER IF EXISTS trg_facture_client_ecriture ON factures;

-- Drop old ledger tables (will be replaced by unified versions)
DROP TABLE IF EXISTS compte_client_lignes CASCADE;
DROP TABLE IF EXISTS compte_fournisseur_lignes CASCADE;
DROP TABLE IF EXISTS acomptes_clients CASCADE;
DROP TABLE IF EXISTS allocation_audit CASCADE;

-- Drop old document tables that reference clients/fournisseurs (cascade)
DROP TABLE IF EXISTS commissions_ventes CASCADE;
DROP TABLE IF EXISTS retour_lignes CASCADE;
DROP TABLE IF EXISTS retours CASCADE;
DROP TABLE IF EXISTS facture_avoir_lignes CASCADE;
DROP TABLE IF EXISTS factures_avoir CASCADE;
DROP TABLE IF EXISTS bon_livraison_lignes CASCADE;
DROP TABLE IF EXISTS bons_livraison CASCADE;
DROP TABLE IF EXISTS devis_lignes CASCADE;
DROP TABLE IF EXISTS devis CASCADE;
DROP TABLE IF EXISTS paiements CASCADE;
DROP TABLE IF EXISTS factures CASCADE;

-- Drop fournisseur-side document tables
DROP TABLE IF EXISTS paiements_fournisseur CASCADE;
DROP TABLE IF EXISTS facture_fournisseur_lignes CASCADE;
DROP TABLE IF EXISTS factures_fournisseur CASCADE;
DROP TABLE IF EXISTS commande_lignes CASCADE;
DROP TABLE IF EXISTS commandes_fournisseur CASCADE;

-- Now safe to drop base tables
DROP TABLE IF EXISTS clients CASCADE;
DROP TABLE IF EXISTS fournisseurs CASCADE;

-- ============================================================
-- 2. CREATE UNIFIED TIERS TABLE
-- ============================================================

CREATE TABLE tiers (
  id              SERIAL PRIMARY KEY,
  code            VARCHAR(20) UNIQUE NOT NULL,
  raison_sociale  VARCHAR(255) NOT NULL,
  prenom          VARCHAR(100),
  telephone       VARCHAR(20),
  email           VARCHAR(255),
  adresse         TEXT,
  nif             VARCHAR(50),
  rccm            VARCHAR(50),
  est_client      BOOLEAN NOT NULL DEFAULT false,
  est_fournisseur BOOLEAN NOT NULL DEFAULT false,
  -- Financial fields (client side)
  credit_max      NUMERIC(15,2) DEFAULT 0.00,
  credit_encours  NUMERIC(15,2) DEFAULT 0.00,
  delai_paiement  VARCHAR(50),
  -- Financial caches (updated by triggers)
  solde_client_actuel      NUMERIC(15,2) DEFAULT 0.00,
  acompte_client_disponible NUMERIC(15,2) DEFAULT 0.00,
  solde_fournisseur_actuel NUMERIC(15,2) DEFAULT 0.00,
  -- Supplier-specific
  delai_livraison INTEGER DEFAULT 7,
  notes           TEXT,
  deleted_at      TIMESTAMP,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tiers_at_least_one_role CHECK (est_client OR est_fournisseur)
);

CREATE TRIGGER update_tiers_updated_at
  BEFORE UPDATE ON tiers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_tiers_code           ON tiers(code);
CREATE INDEX IF NOT EXISTS idx_tiers_raison_sociale ON tiers(raison_sociale);
CREATE INDEX IF NOT EXISTS idx_tiers_est_client     ON tiers(est_client) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tiers_est_fournisseur ON tiers(est_fournisseur) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tiers_nif            ON tiers(nif) WHERE nif IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tiers_deleted_at     ON tiers(deleted_at);

-- Auto-generate code on insert
CREATE OR REPLACE FUNCTION generate_tiers_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    NEW.code := 'TI-' || LPAD(NEW.id::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tiers_code
  BEFORE INSERT ON tiers
  FOR EACH ROW EXECUTE FUNCTION generate_tiers_code();

COMMENT ON TABLE tiers IS 'Unified third-party table: a tiers can be client, fournisseur, or both simultaneously';
COMMENT ON COLUMN tiers.est_client IS 'True if this tiers buys from us (client role)';
COMMENT ON COLUMN tiers.est_fournisseur IS 'True if this tiers sells to us (fournisseur role)';
COMMENT ON COLUMN tiers.solde_client_actuel IS 'Cached: sum of outstanding client invoices (positive = tiers owes us)';
COMMENT ON COLUMN tiers.solde_fournisseur_actuel IS 'Cached: sum of outstanding supplier invoices (positive = we owe tiers)';

-- ============================================================
-- 3. RECREATE CUSTOMER-SIDE DOCUMENT TABLES
-- ============================================================

CREATE TABLE factures (
  id               SERIAL PRIMARY KEY,
  numero_facture   VARCHAR(50) UNIQUE NOT NULL,
  tiers_id         INTEGER NOT NULL REFERENCES tiers(id) ON DELETE RESTRICT,
  devis_id         INTEGER,
  bl_id            INTEGER,
  date_facture     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_echeance    DATE,
  delai_paiement   VARCHAR(50),
  sous_total       NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  tva              NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  total            NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  total_ht         NUMERIC(15,2),
  total_ttc        NUMERIC(15,2),
  montant_paye     NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  remaining_due    NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  statut           VARCHAR(20) DEFAULT 'en_attente'
    CHECK (statut IN ('payee', 'partielle', 'en_attente', 'annulee')),
  type_facture     VARCHAR(20) DEFAULT 'standard'
    CHECK (type_facture IN ('standard', 'avoir', 'echange')),
  hors_taxe        BOOLEAN DEFAULT false,
  exoneration_raison VARCHAR(100),
  notes            TEXT,
  location_id      INTEGER REFERENCES stock_locations(id) ON DELETE SET NULL,
  allocation_version INTEGER DEFAULT 1,
  deleted_at       TIMESTAMP,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_facture_tiers        ON factures(tiers_id);
CREATE INDEX IF NOT EXISTS idx_facture_date         ON factures(date_facture);
CREATE INDEX IF NOT EXISTS idx_facture_statut       ON factures(statut);
CREATE INDEX IF NOT EXISTS idx_facture_echeance     ON factures(date_echeance);
CREATE INDEX IF NOT EXISTS idx_facture_deleted      ON factures(deleted_at);
CREATE INDEX IF NOT EXISTS idx_factures_tiers_date  ON factures(tiers_id, date_facture, id) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION update_facture_ht_ttc()
RETURNS TRIGGER AS $$
BEGIN
  NEW.total_ht  := NEW.sous_total;
  NEW.total_ttc := NEW.total;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_facture_ht_ttc
  BEFORE INSERT OR UPDATE ON factures
  FOR EACH ROW EXECUTE FUNCTION update_facture_ht_ttc();

-- ============================================================

CREATE TABLE paiements (
  id               SERIAL PRIMARY KEY,
  facture_id       INTEGER NOT NULL REFERENCES factures(id) ON DELETE CASCADE,
  montant          NUMERIC(15,2) NOT NULL,
  methode_paiement VARCHAR(50) NOT NULL
    CHECK (methode_paiement IN ('espece','carte','cheque','virement','mobile_money','orange_money','mtn_money','wave')),
  date_paiement    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reference        VARCHAR(100),
  notes            TEXT,
  session_caisse_id INTEGER REFERENCES sessions_caisse(id) ON DELETE SET NULL,
  cree_par         INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_paiements_facture   ON paiements(facture_id);
CREATE INDEX IF NOT EXISTS idx_paiements_date      ON paiements(date_paiement);
CREATE INDEX IF NOT EXISTS idx_paiements_date_id   ON paiements(date_paiement, id);

-- Trigger: auto-update facture payment status
CREATE OR REPLACE FUNCTION update_facture_payment_status()
RETURNS TRIGGER AS $$
DECLARE
  v_facture_id  INTEGER;
  total_due     NUMERIC(15,2);
  total_paid    NUMERIC(15,2);
BEGIN
  v_facture_id := COALESCE(NEW.facture_id, OLD.facture_id);
  SELECT total INTO total_due FROM factures WHERE id = v_facture_id;
  SELECT COALESCE(SUM(montant), 0) INTO total_paid
  FROM paiements WHERE facture_id = v_facture_id;
  UPDATE factures SET
    montant_paye = total_paid,
    remaining_due = total_due - total_paid,
    statut = CASE
      WHEN total_paid = 0          THEN 'en_attente'
      WHEN total_paid < total_due  THEN 'partielle'
      ELSE 'payee'
    END
  WHERE id = v_facture_id;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_after_payment_insert ON paiements;
CREATE TRIGGER trg_after_payment_insert
  AFTER INSERT OR UPDATE OR DELETE ON paiements
  FOR EACH ROW EXECUTE FUNCTION update_facture_payment_status();

-- ============================================================

CREATE TABLE acomptes_clients (
  id               SERIAL PRIMARY KEY,
  tiers_id         INTEGER NOT NULL REFERENCES tiers(id) ON DELETE CASCADE,
  montant          NUMERIC(15,2) NOT NULL,
  methode_paiement VARCHAR(50)
    CHECK (methode_paiement IN ('espece','carte','cheque','virement','mobile_money','orange_money','mtn_money','wave')),
  date_acompte     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  statut           VARCHAR(20) DEFAULT 'disponible'
    CHECK (statut IN ('disponible','utilise','rembourse')),
  facture_id_applique INTEGER REFERENCES factures(id) ON DELETE SET NULL,
  date_utilisation TIMESTAMP,
  notes            TEXT,
  cree_par         INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_acomptes_tiers   ON acomptes_clients(tiers_id);
CREATE INDEX IF NOT EXISTS idx_acomptes_statut  ON acomptes_clients(statut);
CREATE INDEX IF NOT EXISTS idx_acomptes_date    ON acomptes_clients(date_acompte);

COMMENT ON TABLE acomptes_clients IS 'Advance payments received from client-role tiers';

-- ============================================================

CREATE TABLE compte_client_lignes (
  id              SERIAL PRIMARY KEY,
  tiers_id        INTEGER NOT NULL REFERENCES tiers(id) ON DELETE CASCADE,
  date_operation  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  type_operation  VARCHAR(50) NOT NULL
    CHECK (type_operation IN ('facture','paiement','acompte','avoir','remise','ajustement','compensation')),
  document_id     INTEGER,
  document_numero VARCHAR(100),
  montant_debit   NUMERIC(15,2) DEFAULT 0.00,
  montant_credit  NUMERIC(15,2) DEFAULT 0.00,
  solde_avant     NUMERIC(15,2) DEFAULT 0.00,
  solde_apres     NUMERIC(15,2) DEFAULT 0.00,
  notes           TEXT,
  cree_par        INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ccl_tiers      ON compte_client_lignes(tiers_id);
CREATE INDEX IF NOT EXISTS idx_ccl_date       ON compte_client_lignes(date_operation);
CREATE INDEX IF NOT EXISTS idx_ccl_type       ON compte_client_lignes(type_operation);
CREATE INDEX IF NOT EXISTS idx_ccl_document   ON compte_client_lignes(document_id, type_operation);

COMMENT ON TABLE compte_client_lignes IS 'Client-side ledger. debit=tiers owes us, credit=tiers paid/credited';

-- FIFO allocation audit
CREATE TABLE allocation_audit (
  id             SERIAL PRIMARY KEY,
  tiers_id       INTEGER NOT NULL REFERENCES tiers(id) ON DELETE CASCADE,
  allocation_type VARCHAR(50) NOT NULL,
  before_data    JSONB,
  after_data     JSONB,
  created_by     INTEGER,
  notes          TEXT,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_alloc_audit_tiers ON allocation_audit(tiers_id, created_at);

-- ============================================================
-- 4. RECREATE DEVIS / BL / AVOIRS (client-side documents)
-- ============================================================

CREATE TABLE devis (
  id              SERIAL PRIMARY KEY,
  numero_devis    VARCHAR(50) UNIQUE NOT NULL,
  tiers_id        INTEGER NOT NULL REFERENCES tiers(id) ON DELETE RESTRICT,
  date_devis      DATE NOT NULL DEFAULT CURRENT_DATE,
  date_validite   DATE,
  statut          VARCHAR(20) DEFAULT 'brouillon'
    CHECK (statut IN ('brouillon','envoye','accepte','refuse','annule','converti')),
  sous_total      NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  remise_globale  NUMERIC(15,2) DEFAULT 0.00,
  remise_globale_pct NUMERIC(5,2) DEFAULT 0.00,
  tva             NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  total           NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  total_ht        NUMERIC(15,2),
  total_ttc       NUMERIC(15,2),
  notes           TEXT,
  conditions      TEXT,
  location_id     INTEGER REFERENCES stock_locations(id) ON DELETE SET NULL,
  facture_id      INTEGER REFERENCES factures(id) ON DELETE SET NULL,
  cree_par        INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  deleted_at      TIMESTAMP,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER update_devis_updated_at BEFORE UPDATE ON devis FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_devis_tiers   ON devis(tiers_id);
CREATE INDEX IF NOT EXISTS idx_devis_statut  ON devis(statut);
CREATE INDEX IF NOT EXISTS idx_devis_deleted ON devis(deleted_at);

CREATE TABLE devis_lignes (
  id           SERIAL PRIMARY KEY,
  devis_id     INTEGER NOT NULL REFERENCES devis(id) ON DELETE CASCADE,
  produit_id   INTEGER REFERENCES produits(id) ON DELETE SET NULL,
  description  VARCHAR(255),
  quantite     INTEGER NOT NULL DEFAULT 1 CHECK (quantite > 0),
  prix_unitaire NUMERIC(15,2) NOT NULL,
  remise_pct   NUMERIC(5,2) DEFAULT 0.00,
  remise_montant NUMERIC(15,2) DEFAULT 0.00,
  total_ligne  NUMERIC(15,2) NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_devis_lignes_devis ON devis_lignes(devis_id);

-- ============================================================

CREATE TABLE bons_livraison (
  id              SERIAL PRIMARY KEY,
  numero_bl       VARCHAR(50) UNIQUE NOT NULL,
  tiers_id        INTEGER NOT NULL REFERENCES tiers(id) ON DELETE RESTRICT,
  devis_id        INTEGER REFERENCES devis(id) ON DELETE SET NULL,
  date_bl         DATE NOT NULL DEFAULT CURRENT_DATE,
  statut          VARCHAR(20) DEFAULT 'brouillon'
    CHECK (statut IN ('brouillon','valide','livre','facture','annule')),
  facture_id      INTEGER REFERENCES factures(id) ON DELETE SET NULL,
  sous_total      NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  tva             NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  total           NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  notes           TEXT,
  adresse_livraison TEXT,
  date_livraison_prevue DATE,
  location_id     INTEGER REFERENCES stock_locations(id) ON DELETE SET NULL,
  cree_par        INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  deleted_at      TIMESTAMP,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER update_bons_livraison_updated_at BEFORE UPDATE ON bons_livraison FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_bl_tiers   ON bons_livraison(tiers_id);
CREATE INDEX IF NOT EXISTS idx_bl_statut  ON bons_livraison(statut);
CREATE INDEX IF NOT EXISTS idx_bl_deleted ON bons_livraison(deleted_at);

CREATE TABLE bon_livraison_lignes (
  id                  SERIAL PRIMARY KEY,
  bl_id               INTEGER NOT NULL REFERENCES bons_livraison(id) ON DELETE CASCADE,
  produit_id          INTEGER REFERENCES produits(id) ON DELETE SET NULL,
  description         VARCHAR(255),
  quantite_commandee  INTEGER NOT NULL DEFAULT 1 CHECK (quantite_commandee > 0),
  quantite_livree     INTEGER NOT NULL DEFAULT 1 CHECK (quantite_livree >= 0),
  prix_unitaire       NUMERIC(15,2) NOT NULL,
  total_ligne         NUMERIC(15,2) NOT NULL,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bl_lignes_bl ON bon_livraison_lignes(bl_id);

-- ============================================================

CREATE TABLE retours (
  id                  SERIAL PRIMARY KEY,
  numero_retour       VARCHAR(50) UNIQUE NOT NULL,
  tiers_id            INTEGER NOT NULL REFERENCES tiers(id) ON DELETE RESTRICT,
  date_retour         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  total_remboursement NUMERIC(15,2) DEFAULT 0.00,
  statut              VARCHAR(20) DEFAULT 'en_attente'
    CHECK (statut IN ('en_attente','traite','annule')),
  notes               TEXT,
  cree_par            INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_retours_tiers  ON retours(tiers_id);
CREATE INDEX IF NOT EXISTS idx_retours_statut ON retours(statut);

CREATE TABLE retour_lignes (
  id            SERIAL PRIMARY KEY,
  retour_id     INTEGER NOT NULL REFERENCES retours(id) ON DELETE CASCADE,
  facture_id    INTEGER NOT NULL REFERENCES factures(id) ON DELETE RESTRICT,
  produit_id    INTEGER NOT NULL REFERENCES produits(id) ON DELETE RESTRICT,
  quantite      INTEGER NOT NULL DEFAULT 1,
  raison        VARCHAR(500) NOT NULL,
  prix_unitaire NUMERIC(15,2) NOT NULL,
  total_ligne   NUMERIC(15,2) NOT NULL,
  notes         TEXT
);
CREATE INDEX IF NOT EXISTS idx_retour_lignes_retour ON retour_lignes(retour_id);

-- ============================================================

CREATE TABLE factures_avoir (
  id                  SERIAL PRIMARY KEY,
  numero_avoir        VARCHAR(50) UNIQUE NOT NULL,
  tiers_id            INTEGER NOT NULL REFERENCES tiers(id) ON DELETE RESTRICT,
  facture_origine_id  INTEGER REFERENCES factures(id) ON DELETE SET NULL,
  retour_id           INTEGER REFERENCES retours(id) ON DELETE SET NULL,
  date_avoir          DATE NOT NULL DEFAULT CURRENT_DATE,
  sous_total          NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  tva                 NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  total               NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  total_ht            NUMERIC(15,2),
  total_ttc           NUMERIC(15,2),
  statut              VARCHAR(20) DEFAULT 'brouillon'
    CHECK (statut IN ('brouillon','valide','annule','utilise')),
  avoir_type          VARCHAR(20) DEFAULT 'retour'
    CHECK (avoir_type IN ('retour','echange','remise_commerciale','erreur')),
  notes               TEXT,
  location_id         INTEGER REFERENCES stock_locations(id) ON DELETE SET NULL,
  cree_par            INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  deleted_at          TIMESTAMP,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER update_factures_avoir_updated_at BEFORE UPDATE ON factures_avoir FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_avoir_tiers    ON factures_avoir(tiers_id);
CREATE INDEX IF NOT EXISTS idx_avoir_facture  ON factures_avoir(facture_origine_id);
CREATE INDEX IF NOT EXISTS idx_avoir_deleted  ON factures_avoir(deleted_at);

CREATE TABLE facture_avoir_lignes (
  id            SERIAL PRIMARY KEY,
  avoir_id      INTEGER NOT NULL REFERENCES factures_avoir(id) ON DELETE CASCADE,
  produit_id    INTEGER REFERENCES produits(id) ON DELETE SET NULL,
  description   VARCHAR(255),
  quantite      INTEGER NOT NULL DEFAULT 1,
  prix_unitaire NUMERIC(15,2) NOT NULL,
  taux_tva_id   INTEGER REFERENCES taux_tva(id) ON DELETE SET NULL,
  total_ligne   NUMERIC(15,2) NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_avoir_lignes_avoir ON facture_avoir_lignes(avoir_id);

-- ============================================================
-- 5. RECREATE FOURNISSEUR-SIDE DOCUMENT TABLES
-- ============================================================

CREATE TABLE commandes_fournisseur (
  id                    SERIAL PRIMARY KEY,
  tiers_id              INTEGER NOT NULL REFERENCES tiers(id) ON DELETE RESTRICT,
  numero_commande       VARCHAR(50) UNIQUE NOT NULL,
  date_commande         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  date_livraison_prevue DATE,
  date_livraison_reelle DATE,
  statut                VARCHAR(20) DEFAULT 'en_attente'
    CHECK (statut IN ('en_attente','validee','expediee','livree','annulee')),
  sous_total            NUMERIC(15,2) DEFAULT 0.00,
  notes                 TEXT,
  deleted_at            TIMESTAMP,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_commande_tiers  ON commandes_fournisseur(tiers_id);
CREATE INDEX IF NOT EXISTS idx_commande_statut ON commandes_fournisseur(statut);
CREATE INDEX IF NOT EXISTS idx_commande_deleted ON commandes_fournisseur(deleted_at);

CREATE TABLE commande_lignes (
  id            SERIAL PRIMARY KEY,
  commande_id   INTEGER NOT NULL REFERENCES commandes_fournisseur(id) ON DELETE CASCADE,
  produit_id    INTEGER NOT NULL REFERENCES produits(id) ON DELETE RESTRICT,
  quantite      INTEGER NOT NULL DEFAULT 1,
  prix_unitaire NUMERIC(15,2) NOT NULL,
  total_ligne   NUMERIC(15,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_commande_lignes_commande ON commande_lignes(commande_id);

-- ============================================================

CREATE TABLE factures_fournisseur (
  id                          SERIAL PRIMARY KEY,
  tiers_id                    INTEGER NOT NULL REFERENCES tiers(id) ON DELETE RESTRICT,
  reception_id                INTEGER REFERENCES receptions(id) ON DELETE SET NULL,
  numero_facture_fournisseur  VARCHAR(100) NOT NULL,
  numero_facture_interne      VARCHAR(50) UNIQUE NOT NULL,
  date_facture                DATE NOT NULL,
  date_echeance               DATE,
  sous_total                  NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  tva                         NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  total                       NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  montant_paye                NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  reste_due                   NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  statut                      VARCHAR(20) DEFAULT 'en_attente'
    CHECK (statut IN ('en_attente','validee','partiellement_payee','payee','annulee')),
  condition_paiement          VARCHAR(50),
  notes                       TEXT,
  cree_par                    INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tiers_id, numero_facture_fournisseur)
);
CREATE TRIGGER update_factures_fournisseur_updated_at BEFORE UPDATE ON factures_fournisseur FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_ff_tiers    ON factures_fournisseur(tiers_id);
CREATE INDEX IF NOT EXISTS idx_ff_statut   ON factures_fournisseur(statut);
CREATE INDEX IF NOT EXISTS idx_ff_echeance ON factures_fournisseur(date_echeance);

CREATE TABLE facture_fournisseur_lignes (
  id            SERIAL PRIMARY KEY,
  facture_id    INTEGER NOT NULL REFERENCES factures_fournisseur(id) ON DELETE CASCADE,
  produit_id    INTEGER REFERENCES produits(id) ON DELETE SET NULL,
  description   VARCHAR(255),
  quantite      INTEGER NOT NULL DEFAULT 1,
  prix_unitaire NUMERIC(15,2) NOT NULL,
  tva_taux      NUMERIC(5,2) DEFAULT 0.00,
  total_ligne   NUMERIC(15,2) NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE paiements_fournisseur (
  id               SERIAL PRIMARY KEY,
  facture_id       INTEGER NOT NULL REFERENCES factures_fournisseur(id) ON DELETE CASCADE,
  montant          NUMERIC(15,2) NOT NULL,
  methode_paiement VARCHAR(50) NOT NULL
    CHECK (methode_paiement IN ('espece','carte','cheque','virement','mobile_money','orange_money','mtn_money','wave')),
  date_paiement    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reference        VARCHAR(100),
  notes            TEXT,
  effectue_par     INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_paiement_ff ON paiements_fournisseur(facture_id);

-- Trigger: auto-update supplier invoice status
CREATE OR REPLACE FUNCTION update_facture_fournisseur_payment_status()
RETURNS TRIGGER AS $$
DECLARE
  v_facture_id INTEGER;
  total_due    NUMERIC(15,2);
  total_paid   NUMERIC(15,2);
BEGIN
  v_facture_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.facture_id ELSE NEW.facture_id END;
  SELECT total INTO total_due FROM factures_fournisseur WHERE id = v_facture_id;
  SELECT COALESCE(SUM(montant), 0) INTO total_paid
  FROM paiements_fournisseur WHERE facture_id = v_facture_id;
  UPDATE factures_fournisseur SET
    montant_paye = total_paid,
    reste_due    = total_due - total_paid,
    statut = CASE
      WHEN total_paid = 0         THEN 'en_attente'
      WHEN total_paid < total_due THEN 'partiellement_payee'
      ELSE 'payee'
    END
  WHERE id = v_facture_id;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_paiement_ff_iud ON paiements_fournisseur;
CREATE TRIGGER trg_paiement_ff_iud
  AFTER INSERT OR UPDATE OR DELETE ON paiements_fournisseur
  FOR EACH ROW EXECUTE FUNCTION update_facture_fournisseur_payment_status();

-- ============================================================

CREATE TABLE compte_fournisseur_lignes (
  id              SERIAL PRIMARY KEY,
  tiers_id        INTEGER NOT NULL REFERENCES tiers(id) ON DELETE RESTRICT,
  type_operation  VARCHAR(30) NOT NULL
    CHECK (type_operation IN ('facture','paiement','avoir','ajustement','compensation','acompte')),
  document_id     INTEGER,
  document_numero VARCHAR(100),
  montant_debit   NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  montant_credit  NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  notes           TEXT,
  cree_par        INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cfl_tiers    ON compte_fournisseur_lignes(tiers_id);
CREATE INDEX IF NOT EXISTS idx_cfl_type     ON compte_fournisseur_lignes(type_operation);

COMMENT ON TABLE compte_fournisseur_lignes IS 'Supplier-side ledger. debit=we paid (reduces AP), credit=new invoice received (increases AP)';

-- ============================================================
-- 6. ACOMPTES FOURNISSEUR (advances paid to suppliers)
-- ============================================================

CREATE TABLE acomptes_fournisseur (
  id               SERIAL PRIMARY KEY,
  tiers_id         INTEGER NOT NULL REFERENCES tiers(id) ON DELETE CASCADE,
  montant          NUMERIC(15,2) NOT NULL,
  methode_paiement VARCHAR(50)
    CHECK (methode_paiement IN ('espece','carte','cheque','virement','mobile_money','orange_money','mtn_money','wave')),
  date_acompte     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  statut           VARCHAR(20) DEFAULT 'disponible'
    CHECK (statut IN ('disponible','utilise','rembourse')),
  facture_id_applique INTEGER REFERENCES factures_fournisseur(id) ON DELETE SET NULL,
  date_utilisation TIMESTAMP,
  notes            TEXT,
  cree_par         INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_acomptes_fourn_tiers  ON acomptes_fournisseur(tiers_id);
CREATE INDEX IF NOT EXISTS idx_acomptes_fourn_statut ON acomptes_fournisseur(statut);

COMMENT ON TABLE acomptes_fournisseur IS 'Advance payments made to supplier-role tiers';

-- ============================================================
-- 7. COMPENSATIONS TABLE
-- ============================================================

CREATE TABLE compensations (
  id                        SERIAL PRIMARY KEY,
  tiers_id                  INTEGER NOT NULL REFERENCES tiers(id) ON DELETE RESTRICT,
  date_compensation         DATE NOT NULL DEFAULT CURRENT_DATE,
  montant                   NUMERIC(15,2) NOT NULL CHECK (montant > 0),
  factures_client_ids       INTEGER[] NOT NULL DEFAULT '{}',
  factures_fournisseur_ids  INTEGER[] NOT NULL DEFAULT '{}',
  ecriture_id               INTEGER REFERENCES ecritures_comptables(id) ON DELETE SET NULL,
  notes                     TEXT,
  statut                    VARCHAR(20) DEFAULT 'valide'
    CHECK (statut IN ('valide','annule')),
  cree_par                  INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_comp_tiers  ON compensations(tiers_id);
CREATE INDEX IF NOT EXISTS idx_comp_statut ON compensations(statut);

COMMENT ON TABLE compensations IS 'Netting operations: extinguishes min(créance_client, dette_fourn) with OD journal entry 401↔411';

-- ============================================================
-- 8. ACCOUNTING TRIGGERS ON NEW TABLES
-- ============================================================

-- Trigger: journal entry on customer invoice creation
CREATE OR REPLACE FUNCTION create_ecritures_facture_client()
RETURNS TRIGGER AS $$
DECLARE
  compte_vente_id    INTEGER;
  compte_tva_id      INTEGER;
  compte_client_id   INTEGER;
BEGIN
  compte_vente_id  := ensure_plan_compte('701','Ventes de marchandises','produit','classe7');
  compte_tva_id    := ensure_plan_compte('4457','TVA collectée','passif','classe4');
  compte_client_id := ensure_plan_compte('411','Clients','actif','classe4');

  INSERT INTO ecritures_comptables (numero_piece, date_ecriture, journal, piece_id, piece_type, ligne_numero, compte_id, debit, credit, description)
  VALUES (NEW.numero_facture, NEW.date_facture, 'VENTES', NEW.id, 'facture', 1, compte_client_id, NEW.total, 0, 'Vente client - ' || NEW.numero_facture);

  INSERT INTO ecritures_comptables (numero_piece, date_ecriture, journal, piece_id, piece_type, ligne_numero, compte_id, debit, credit, description)
  VALUES (NEW.numero_facture, NEW.date_facture, 'VENTES', NEW.id, 'facture', 2, compte_vente_id, 0, NEW.sous_total, 'CA - ' || NEW.numero_facture);

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
  FOR EACH ROW EXECUTE FUNCTION create_ecritures_facture_client();

-- Trigger: journal entry on supplier invoice creation
CREATE OR REPLACE FUNCTION create_ecritures_facture_fournisseur()
RETURNS TRIGGER AS $$
DECLARE
  compte_achat_id      INTEGER;
  compte_tva_id        INTEGER;
  compte_fourn_id      INTEGER;
BEGIN
  compte_achat_id := ensure_plan_compte('601','Achats de marchandises','charge','classe6');
  compte_tva_id   := ensure_plan_compte('4456','TVA déductible','actif','classe4');
  compte_fourn_id := ensure_plan_compte('401','Fournisseurs','passif','classe4');

  INSERT INTO ecritures_comptables (numero_piece, date_ecriture, journal, piece_id, piece_type, ligne_numero, compte_id, debit, credit, description)
  VALUES (NEW.numero_facture_interne, NEW.date_facture, 'ACHATS', NEW.id, 'facture_fournisseur', 1, compte_achat_id, NEW.sous_total, 0, 'Achat - ' || NEW.numero_facture_fournisseur);

  IF NEW.tva > 0 THEN
    INSERT INTO ecritures_comptables (numero_piece, date_ecriture, journal, piece_id, piece_type, ligne_numero, compte_id, debit, credit, description)
    VALUES (NEW.numero_facture_interne, NEW.date_facture, 'ACHATS', NEW.id, 'facture_fournisseur', 2, compte_tva_id, NEW.tva, 0, 'TVA déductible - ' || NEW.numero_facture_fournisseur);
  END IF;

  INSERT INTO ecritures_comptables (numero_piece, date_ecriture, journal, piece_id, piece_type, ligne_numero, compte_id, debit, credit, description)
  VALUES (NEW.numero_facture_interne, NEW.date_facture, 'ACHATS', NEW.id, 'facture_fournisseur', 3, compte_fourn_id, 0, NEW.total, 'Dette fourn. - ' || NEW.numero_facture_fournisseur);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_facture_fournisseur_ecriture ON factures_fournisseur;
CREATE TRIGGER trg_facture_fournisseur_ecriture
  AFTER INSERT ON factures_fournisseur
  FOR EACH ROW EXECUTE FUNCTION create_ecritures_facture_fournisseur();

-- ============================================================
-- 9. HELPER FUNCTIONS
-- ============================================================

-- Drop old versions with legacy parameter names before recreating
DROP FUNCTION IF EXISTS calculer_solde_client(INTEGER);
DROP FUNCTION IF EXISTS calculer_solde_fournisseur(INTEGER);
DROP FUNCTION IF EXISTS calculer_solde_net(INTEGER);
DROP FUNCTION IF EXISTS calculer_acompte_disponible(INTEGER);

-- Compute current client-side balance for a tiers (live, not cached)
CREATE OR REPLACE FUNCTION calculer_solde_client(p_tiers_id INTEGER)
RETURNS NUMERIC(15,2) AS $$
DECLARE v_solde NUMERIC(15,2);
BEGIN
  SELECT
    COALESCE(SUM(f.total),0)
    - COALESCE((SELECT SUM(p.montant) FROM paiements p JOIN factures f2 ON f2.id = p.facture_id WHERE f2.tiers_id = p_tiers_id AND f2.deleted_at IS NULL),0)
    - COALESCE((SELECT SUM(fa.total) FROM factures_avoir fa WHERE fa.tiers_id = p_tiers_id AND fa.statut IN ('valide','utilise') AND fa.deleted_at IS NULL),0)
    - COALESCE((SELECT SUM(ac.montant) FROM acomptes_clients ac WHERE ac.tiers_id = p_tiers_id AND ac.statut IN ('disponible','utilise')),0)
  INTO v_solde
  FROM factures f
  WHERE f.tiers_id = p_tiers_id AND f.statut != 'annulee' AND f.deleted_at IS NULL;
  RETURN COALESCE(v_solde, 0);
END;
$$ LANGUAGE plpgsql;

-- Compute current supplier-side balance for a tiers (live, not cached)
CREATE OR REPLACE FUNCTION calculer_solde_fournisseur(p_tiers_id INTEGER)
RETURNS NUMERIC(15,2) AS $$
DECLARE v_solde NUMERIC(15,2);
BEGIN
  SELECT
    COALESCE(SUM(ff.total),0)
    - COALESCE((SELECT SUM(pf.montant) FROM paiements_fournisseur pf JOIN factures_fournisseur ff2 ON ff2.id = pf.facture_id WHERE ff2.tiers_id = p_tiers_id),0)
    - COALESCE((SELECT SUM(af.montant) FROM acomptes_fournisseur af WHERE af.tiers_id = p_tiers_id AND af.statut IN ('disponible','utilise')),0)
  INTO v_solde
  FROM factures_fournisseur ff
  WHERE ff.tiers_id = p_tiers_id AND ff.statut != 'annulee';
  RETURN COALESCE(v_solde, 0);
END;
$$ LANGUAGE plpgsql;

-- Net balance: positive = tiers owes us, negative = we owe tiers
CREATE OR REPLACE FUNCTION calculer_solde_net(p_tiers_id INTEGER)
RETURNS NUMERIC(15,2) AS $$
BEGIN
  RETURN calculer_solde_client(p_tiers_id) - calculer_solde_fournisseur(p_tiers_id);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 10. SEQUENCES FOR DOCUMENT NUMBERING (re-apply)
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS avoir_seq START 1;
CREATE SEQUENCE IF NOT EXISTS depense_seq START 1;
CREATE SEQUENCE IF NOT EXISTS transfert_caisse_seq START 1;

-- ============================================================
-- 11. RE-LINK produits.fournisseur_id → tiers
-- ============================================================

-- Drop old FK to fournisseurs (column may not exist on fresh DB, guard with DO)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'produits' AND column_name = 'fournisseur_id'
  ) THEN
    ALTER TABLE produits DROP CONSTRAINT IF EXISTS produits_fournisseur_id_fkey;
    ALTER TABLE produits ADD CONSTRAINT produits_tiers_id_fkey
      FOREIGN KEY (fournisseur_id) REFERENCES tiers(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- 12. RE-LINK depenses.fournisseur_id → tiers
-- ============================================================

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'depenses' AND column_name = 'fournisseur_id'
  ) THEN
    ALTER TABLE depenses DROP CONSTRAINT IF EXISTS depenses_fournisseur_id_fkey;
    ALTER TABLE depenses ALTER COLUMN fournisseur_id TYPE INTEGER;
    ALTER TABLE depenses ADD CONSTRAINT depenses_tiers_id_fkey
      FOREIGN KEY (fournisseur_id) REFERENCES tiers(id) ON DELETE SET NULL;
    -- Rename column for clarity
    ALTER TABLE depenses RENAME COLUMN fournisseur_id TO tiers_id;
  END IF;
END $$;

-- ============================================================
-- 13. RE-LINK ravitaillements_carburant.fournisseur_id → tiers
-- ============================================================

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ravitaillements_carburant' AND column_name = 'fournisseur_id'
  ) THEN
    ALTER TABLE ravitaillements_carburant DROP CONSTRAINT IF EXISTS ravitaillements_carburant_fournisseur_id_fkey;
    ALTER TABLE ravitaillements_carburant ADD CONSTRAINT ravitaillements_tiers_id_fkey
      FOREIGN KEY (fournisseur_id) REFERENCES tiers(id) ON DELETE SET NULL;
    ALTER TABLE ravitaillements_carburant RENAME COLUMN fournisseur_id TO tiers_id;
  END IF;
END $$;

-- ============================================================
-- 14. THREE-WAY MATCH UPDATE
-- ============================================================

-- three_way_matches already references commandes_fournisseur and receptions;
-- those now cascade properly through tiers. No schema change needed.

-- ============================================================
-- 15. SEED DATA
-- ============================================================

-- Walk-in client required by POSService
INSERT INTO tiers (code, raison_sociale, est_client, est_fournisseur)
VALUES ('PASS', 'Client Passager', true, false)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
SELECT '043_unified_tiers: migration completed' as status;
