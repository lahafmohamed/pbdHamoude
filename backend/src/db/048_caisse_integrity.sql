-- Migration 048: Caisse integrity — tight Caisse ↔ Acompte ↔ Facture linkage
-- Additive + safe rename. No drops of existing columns.
-- Goal: every caisse line has a source; acomptes support partial application;
-- day close balances cash by method.

BEGIN;

-- ============================================================
-- 1. RENAME mouvements_caisse.session_id -> session_caisse_id
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'mouvements_caisse' AND column_name = 'session_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'mouvements_caisse' AND column_name = 'session_caisse_id'
  ) THEN
    ALTER TABLE mouvements_caisse RENAME COLUMN session_id TO session_caisse_id;
  END IF;
END $$;

-- ============================================================
-- 2. mouvements_caisse: idempotency, reversal, magasin denorm, source CHECK
-- ============================================================
ALTER TABLE mouvements_caisse
  ADD COLUMN IF NOT EXISTS magasin_id INTEGER REFERENCES magasins(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(80),
  ADD COLUMN IF NOT EXISTS reversed_by_mouvement_id INTEGER REFERENCES mouvements_caisse(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reverses_mouvement_id INTEGER REFERENCES mouvements_caisse(id) ON DELETE SET NULL;

-- Backfill magasin_id from session
UPDATE mouvements_caisse mc
SET magasin_id = s.magasin_id
FROM sessions_caisse s
WHERE mc.session_caisse_id = s.id
  AND mc.magasin_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mouvements_idempotency
  ON mouvements_caisse(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mouvements_magasin_date
  ON mouvements_caisse(magasin_id, date_mouvement);

-- Source-link constraint: every line must reference a source unless it's
-- an explicit "divers" category with a libelle/description.
ALTER TABLE mouvements_caisse
  DROP CONSTRAINT IF EXISTS chk_mouvement_source;

ALTER TABLE mouvements_caisse
  ADD CONSTRAINT chk_mouvement_source CHECK (
    (reference_type IS NOT NULL AND reference_id IS NOT NULL)
    OR categorie IN ('apport','retrait_banque','autre_entree','autre_sortie')
  );

-- methode_paiement required (was nullable in 012)
UPDATE mouvements_caisse SET methode_paiement = 'espece'
  WHERE methode_paiement IS NULL;

-- Widen CHECK to match paiements/acomptes enum (012 only had espece/carte/cheque/virement)
ALTER TABLE mouvements_caisse
  DROP CONSTRAINT IF EXISTS mouvements_caisse_methode_paiement_check;

ALTER TABLE mouvements_caisse
  ADD CONSTRAINT mouvements_caisse_methode_paiement_check
  CHECK (methode_paiement IN ('espece','carte','cheque','virement','mobile_money','orange_money','mtn_money','wave'));

ALTER TABLE mouvements_caisse
  ALTER COLUMN methode_paiement SET NOT NULL;

-- Append-only enforcement: refuse UPDATE/DELETE on closed-session lines.
-- Reversal goes through a NEW row pointing back via reverses_mouvement_id.
CREATE OR REPLACE FUNCTION enforce_mouvement_append_only()
RETURNS TRIGGER AS $$
DECLARE
  v_statut VARCHAR(20);
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'mouvements_caisse is append-only: DELETE forbidden (id=%)', OLD.id;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Allow only reversal-link backfill (reversed_by_mouvement_id) and
    -- updated_at touchups. Block all monetary/source edits.
    IF NEW.montant IS DISTINCT FROM OLD.montant
      OR NEW.type IS DISTINCT FROM OLD.type
      OR NEW.categorie IS DISTINCT FROM OLD.categorie
      OR NEW.reference_type IS DISTINCT FROM OLD.reference_type
      OR NEW.reference_id IS DISTINCT FROM OLD.reference_id
      OR NEW.methode_paiement IS DISTINCT FROM OLD.methode_paiement
      OR NEW.session_caisse_id IS DISTINCT FROM OLD.session_caisse_id
    THEN
      RAISE EXCEPTION 'mouvements_caisse is append-only: cannot mutate financial fields on id=%', OLD.id;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT statut INTO v_statut FROM sessions_caisse WHERE id = NEW.session_caisse_id;
    IF v_statut IS NULL THEN
      RAISE EXCEPTION 'Session % introuvable', NEW.session_caisse_id;
    END IF;
    IF v_statut <> 'ouverte' THEN
      RAISE EXCEPTION 'Session % cloturée — impossible d''ajouter un mouvement', NEW.session_caisse_id;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mouvement_append_only ON mouvements_caisse;
CREATE TRIGGER trg_mouvement_append_only
  BEFORE INSERT OR UPDATE OR DELETE ON mouvements_caisse
  FOR EACH ROW EXECUTE FUNCTION enforce_mouvement_append_only();

-- ============================================================
-- 3. paiements: idempotency, source flag, caisse line link
-- ============================================================
ALTER TABLE paiements
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(80),
  ADD COLUMN IF NOT EXISTS mouvement_caisse_id INTEGER REFERENCES mouvements_caisse(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

ALTER TABLE paiements
  DROP CONSTRAINT IF EXISTS chk_paiement_source;

ALTER TABLE paiements
  ADD CONSTRAINT chk_paiement_source CHECK (source IN ('direct','acompte_application','reversal'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_paiements_idempotency
  ON paiements(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_paiements_source ON paiements(source);

-- ============================================================
-- 4. acomptes_clients: partial application, idempotency, caisse link
-- ============================================================
ALTER TABLE acomptes_clients
  ADD COLUMN IF NOT EXISTS session_caisse_id INTEGER REFERENCES sessions_caisse(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mouvement_caisse_id INTEGER REFERENCES mouvements_caisse(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS montant_restant NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(80),
  ADD COLUMN IF NOT EXISTS reference_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS rembourse_par_user_id INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS date_remboursement TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- Backfill montant_restant from current statut
UPDATE acomptes_clients
SET montant_restant = CASE
  WHEN statut = 'disponible' THEN montant
  WHEN statut IN ('utilise','rembourse') THEN 0
  ELSE montant
END
WHERE montant_restant IS NULL;

ALTER TABLE acomptes_clients
  ALTER COLUMN montant_restant SET NOT NULL;

-- Extend statut enum
ALTER TABLE acomptes_clients DROP CONSTRAINT IF EXISTS acomptes_clients_statut_check;
ALTER TABLE acomptes_clients
  ADD CONSTRAINT acomptes_clients_statut_check
  CHECK (statut IN ('disponible','partiellement_utilise','utilise','rembourse'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_acomptes_idempotency
  ON acomptes_clients(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_acomptes_restant
  ON acomptes_clients(tiers_id, statut)
  WHERE deleted_at IS NULL AND montant_restant > 0;

-- ============================================================
-- 5. acompte_applications: ledger of partial uses
-- ============================================================
CREATE TABLE IF NOT EXISTS acompte_applications (
  id              SERIAL PRIMARY KEY,
  acompte_id      INTEGER NOT NULL REFERENCES acomptes_clients(id) ON DELETE RESTRICT,
  facture_id      INTEGER NOT NULL REFERENCES factures(id) ON DELETE RESTRICT,
  paiement_id     INTEGER REFERENCES paiements(id) ON DELETE SET NULL,
  montant         NUMERIC(15,2) NOT NULL CHECK (montant > 0),
  date_application TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cree_par        INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  notes           TEXT,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_acompte_app_acompte ON acompte_applications(acompte_id);
CREATE INDEX IF NOT EXISTS idx_acompte_app_facture ON acompte_applications(facture_id);
CREATE INDEX IF NOT EXISTS idx_acompte_app_paiement ON acompte_applications(paiement_id);

-- Σ(applications.montant) per acompte ≤ acompte.montant
CREATE OR REPLACE FUNCTION enforce_acompte_application_cap()
RETURNS TRIGGER AS $$
DECLARE
  v_total_applied NUMERIC(15,2);
  v_montant_acompte NUMERIC(15,2);
BEGIN
  SELECT COALESCE(SUM(montant),0) INTO v_total_applied
    FROM acompte_applications WHERE acompte_id = NEW.acompte_id;
  SELECT montant INTO v_montant_acompte
    FROM acomptes_clients WHERE id = NEW.acompte_id;
  IF v_total_applied > v_montant_acompte THEN
    RAISE EXCEPTION 'Application dépasse le montant de l''acompte (%/%)', v_total_applied, v_montant_acompte;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_acompte_app_cap ON acompte_applications;
CREATE TRIGGER trg_acompte_app_cap
  AFTER INSERT OR UPDATE ON acompte_applications
  FOR EACH ROW EXECUTE FUNCTION enforce_acompte_application_cap();

-- Sync acompte.montant_restant / statut after each application
CREATE OR REPLACE FUNCTION sync_acompte_after_application()
RETURNS TRIGGER AS $$
DECLARE
  v_acompte_id INTEGER;
  v_total_applied NUMERIC(15,2);
  v_montant NUMERIC(15,2);
  v_new_restant NUMERIC(15,2);
  v_new_statut VARCHAR(30);
BEGIN
  v_acompte_id := COALESCE(NEW.acompte_id, OLD.acompte_id);
  SELECT COALESCE(SUM(montant),0) INTO v_total_applied
    FROM acompte_applications WHERE acompte_id = v_acompte_id;
  SELECT montant INTO v_montant
    FROM acomptes_clients WHERE id = v_acompte_id;

  v_new_restant := v_montant - v_total_applied;
  IF v_new_restant <= 0 THEN
    v_new_statut := 'utilise';
    v_new_restant := 0;
  ELSIF v_total_applied = 0 THEN
    v_new_statut := 'disponible';
  ELSE
    v_new_statut := 'partiellement_utilise';
  END IF;

  UPDATE acomptes_clients
    SET montant_restant = v_new_restant,
        statut = CASE WHEN statut = 'rembourse' THEN 'rembourse' ELSE v_new_statut END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = v_acompte_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_acompte_after_app ON acompte_applications;
CREATE TRIGGER trg_sync_acompte_after_app
  AFTER INSERT OR UPDATE OR DELETE ON acompte_applications
  FOR EACH ROW EXECUTE FUNCTION sync_acompte_after_application();

-- ============================================================
-- 6. sessions_caisse: per-method totals + expected_cash
-- ============================================================
ALTER TABLE sessions_caisse
  ADD COLUMN IF NOT EXISTS totaux_par_methode JSONB,
  ADD COLUMN IF NOT EXISTS expected_cash NUMERIC(15,2);

-- ============================================================
-- 7. factures: magasin_id, cree_par (additive)
-- ============================================================
ALTER TABLE factures
  ADD COLUMN IF NOT EXISTS magasin_id INTEGER REFERENCES magasins(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS cree_par INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL;

UPDATE factures f
SET magasin_id = m.id
FROM magasins m
WHERE m.location_id = f.location_id
  AND f.magasin_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_factures_magasin ON factures(magasin_id);

-- ============================================================
-- 8. Day-close helper view: per-session method breakdown
-- ============================================================
CREATE OR REPLACE VIEW vue_session_methode_totaux AS
SELECT
  mc.session_caisse_id,
  mc.methode_paiement,
  COALESCE(SUM(CASE WHEN mc.type = 'encaissement' THEN mc.montant ELSE 0 END), 0) AS total_encaissements,
  COALESCE(SUM(CASE WHEN mc.type = 'decaissement' THEN mc.montant ELSE 0 END), 0) AS total_decaissements,
  COUNT(*) AS nb_mouvements
FROM mouvements_caisse mc
GROUP BY mc.session_caisse_id, mc.methode_paiement;

COMMENT ON VIEW vue_session_methode_totaux IS 'Per-session, per-method cash flow totals — used by day-close';

-- ============================================================
-- 9. Verify
-- ============================================================
SELECT 'Migration 048 done.' AS info;

COMMIT;
