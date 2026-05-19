-- ============================================================
-- 052_paiement_mouvement_deferred.sql
-- Replace eager CHECK chk_paiement_espece_mouvement with a
-- DEFERRABLE constraint trigger that fires at COMMIT.
-- Reason: PaiementController inserts paiement first, then creates
-- mouvements_caisse, then UPDATEs paiement.mouvement_caisse_id.
-- A non-deferrable CHECK fires at INSERT and rejects valid flows.
-- ============================================================

-- Drop old eager CHECK if present
ALTER TABLE paiements DROP CONSTRAINT IF EXISTS chk_paiement_espece_mouvement;

-- Trigger function: enforce link at COMMIT
CREATE OR REPLACE FUNCTION enforce_paiement_espece_mouvement()
RETURNS TRIGGER AS $$
DECLARE
  v_methode TEXT;
  v_source  TEXT;
  v_mvt     INTEGER;
  v_deleted TIMESTAMP;
BEGIN
  -- Re-fetch current row state at commit time (deferred trigger captures
  -- NEW from the queueing event; need fresh state to see later UPDATEs).
  SELECT methode_paiement, source, mouvement_caisse_id, deleted_at
    INTO v_methode, v_source, v_mvt, v_deleted
  FROM paiements WHERE id = NEW.id;

  -- Row deleted within tx? skip.
  IF NOT FOUND OR v_deleted IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF v_methode = 'espece'
     AND v_source = 'direct'
     AND v_mvt IS NULL
  THEN
    RAISE EXCEPTION
      'paiement % (espece/direct) sans mouvement_caisse_id à la fin de la transaction',
      NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_paiement_espece_mouvement ON paiements;

CREATE CONSTRAINT TRIGGER trg_paiement_espece_mouvement
  AFTER INSERT OR UPDATE OF methode_paiement, source, mouvement_caisse_id
  ON paiements
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_paiement_espece_mouvement();

COMMENT ON FUNCTION enforce_paiement_espece_mouvement() IS
  'Deferred check: paiement espece+direct must end transaction with mouvement_caisse_id set. Fires at COMMIT only.';
