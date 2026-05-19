-- ============================================================
-- 051_acompte_fournisseur_applications.sql
-- Symmetric apply/refund infrastructure for supplier acomptes
-- ============================================================

-- 1. paiements_fournisseur: parity with paiements (source, caisse link, magasin)
ALTER TABLE paiements_fournisseur
  ADD COLUMN IF NOT EXISTS source              VARCHAR(30) NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS mouvement_caisse_id INTEGER REFERENCES mouvements_caisse(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS magasin_id          INTEGER REFERENCES magasins(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS session_caisse_id   INTEGER REFERENCES sessions_caisse(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS idempotency_key     VARCHAR(80),
  ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS deleted_at          TIMESTAMP;

ALTER TABLE paiements_fournisseur DROP CONSTRAINT IF EXISTS chk_pf_source;
ALTER TABLE paiements_fournisseur
  ADD CONSTRAINT chk_pf_source CHECK (source IN ('direct','acompte_application','reversal'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_paiements_fourn_idempotency
  ON paiements_fournisseur(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_paiements_fourn_source ON paiements_fournisseur(source);

-- 2. acompte_applications_fournisseur: ledger of partial uses
CREATE TABLE IF NOT EXISTS acompte_applications_fournisseur (
  id              SERIAL PRIMARY KEY,
  acompte_id      INTEGER NOT NULL REFERENCES acomptes_fournisseur(id) ON DELETE RESTRICT,
  facture_id      INTEGER NOT NULL REFERENCES factures_fournisseur(id) ON DELETE RESTRICT,
  paiement_id     INTEGER REFERENCES paiements_fournisseur(id) ON DELETE SET NULL,
  montant         NUMERIC(15,2) NOT NULL CHECK (montant > 0),
  date_application TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cree_par        INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  notes           TEXT,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_acompte_app_fourn_acompte  ON acompte_applications_fournisseur(acompte_id);
CREATE INDEX IF NOT EXISTS idx_acompte_app_fourn_facture  ON acompte_applications_fournisseur(facture_id);
CREATE INDEX IF NOT EXISTS idx_acompte_app_fourn_paiement ON acompte_applications_fournisseur(paiement_id);

-- 3. Cap trigger: Σ(applications.montant) per acompte ≤ acompte.montant
CREATE OR REPLACE FUNCTION enforce_acompte_fournisseur_application_cap()
RETURNS TRIGGER AS $$
DECLARE
  v_total_applied   NUMERIC(15,2);
  v_montant_acompte NUMERIC(15,2);
BEGIN
  SELECT COALESCE(SUM(montant),0) INTO v_total_applied
    FROM acompte_applications_fournisseur WHERE acompte_id = NEW.acompte_id;
  SELECT montant INTO v_montant_acompte
    FROM acomptes_fournisseur WHERE id = NEW.acompte_id;

  IF v_total_applied > v_montant_acompte + 0.005 THEN
    RAISE EXCEPTION
      'Σ(applications)=%, dépasse acompte_fournisseur #%=%',
      v_total_applied, NEW.acompte_id, v_montant_acompte;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_acompte_fourn_cap ON acompte_applications_fournisseur;
CREATE TRIGGER trg_acompte_fourn_cap
  AFTER INSERT OR UPDATE ON acompte_applications_fournisseur
  FOR EACH ROW EXECUTE FUNCTION enforce_acompte_fournisseur_application_cap();

-- 4. Sync trigger: update acomptes_fournisseur.montant_restant + statut
CREATE OR REPLACE FUNCTION sync_acompte_fournisseur_state()
RETURNS TRIGGER AS $$
DECLARE
  v_acompte_id      INTEGER;
  v_total_applied   NUMERIC(15,2);
  v_montant_total   NUMERIC(15,2);
  v_montant_restant NUMERIC(15,2);
  v_statut          VARCHAR(30);
  v_rembourse       BOOLEAN;
BEGIN
  v_acompte_id := COALESCE(NEW.acompte_id, OLD.acompte_id);

  SELECT COALESCE(SUM(montant),0) INTO v_total_applied
    FROM acompte_applications_fournisseur WHERE acompte_id = v_acompte_id;

  SELECT montant, statut = 'rembourse'
    INTO v_montant_total, v_rembourse
    FROM acomptes_fournisseur WHERE id = v_acompte_id;

  v_montant_restant := GREATEST(v_montant_total - v_total_applied, 0);

  IF v_rembourse THEN
    v_statut := 'rembourse';
  ELSIF v_total_applied <= 0.005 THEN
    v_statut := 'disponible';
  ELSIF v_montant_restant <= 0.005 THEN
    v_statut := 'utilise';
  ELSE
    v_statut := 'partiellement_utilise';
  END IF;

  UPDATE acomptes_fournisseur
  SET montant_restant = v_montant_restant,
      statut = v_statut,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = v_acompte_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_acompte_fourn_sync ON acompte_applications_fournisseur;
CREATE TRIGGER trg_acompte_fourn_sync
  AFTER INSERT OR UPDATE OR DELETE ON acompte_applications_fournisseur
  FOR EACH ROW EXECUTE FUNCTION sync_acompte_fournisseur_state();
