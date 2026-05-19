-- ============================================================
-- 050_caisse_payment_invariants.sql
-- Enforce: cash payment ⇔ caisse session linkage
-- Add audit view for orphan detection
-- ============================================================

-- ============================================================
-- 1. paiements: invariants
-- ============================================================

-- 1a. Cash payment must have a session (unless source='acompte_application',
--     in which case money was already in caisse at acompte creation).
ALTER TABLE paiements
  DROP CONSTRAINT IF EXISTS chk_paiement_espece_session;

ALTER TABLE paiements
  ADD CONSTRAINT chk_paiement_espece_session CHECK (
    methode_paiement <> 'espece'
    OR source = 'acompte_application'
    OR session_caisse_id IS NOT NULL
  ) NOT VALID;

-- 1b. acompte_application paiements must NOT carry session_caisse_id
--     (money already entered when acompte was created — double-counting risk).
ALTER TABLE paiements
  DROP CONSTRAINT IF EXISTS chk_paiement_acompte_no_session;

ALTER TABLE paiements
  ADD CONSTRAINT chk_paiement_acompte_no_session CHECK (
    source <> 'acompte_application'
    OR session_caisse_id IS NULL
  ) NOT VALID;

-- 1c. Cash, direct-source payment must have mouvement_caisse_id linked.
--     Backfilled via 050b script before VALIDATE.
ALTER TABLE paiements
  DROP CONSTRAINT IF EXISTS chk_paiement_espece_mouvement;

ALTER TABLE paiements
  ADD CONSTRAINT chk_paiement_espece_mouvement CHECK (
    methode_paiement <> 'espece'
    OR source <> 'direct'
    OR mouvement_caisse_id IS NOT NULL
  ) NOT VALID;

-- ============================================================
-- 2. magasin coherence between mouvements_caisse and sessions_caisse
-- ============================================================
CREATE OR REPLACE FUNCTION enforce_mouvement_magasin_coherence()
RETURNS TRIGGER AS $$
DECLARE
  v_session_magasin INTEGER;
BEGIN
  IF NEW.magasin_id IS NULL THEN
    -- Auto-fill from session
    SELECT magasin_id INTO NEW.magasin_id
      FROM sessions_caisse WHERE id = NEW.session_caisse_id;
    RETURN NEW;
  END IF;

  SELECT magasin_id INTO v_session_magasin
    FROM sessions_caisse WHERE id = NEW.session_caisse_id;

  IF v_session_magasin IS NOT NULL AND v_session_magasin <> NEW.magasin_id THEN
    RAISE EXCEPTION
      'mouvements_caisse.magasin_id (%) ne correspond pas à sessions_caisse.magasin_id (%) pour session %',
      NEW.magasin_id, v_session_magasin, NEW.session_caisse_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mouvement_magasin_coherence ON mouvements_caisse;
CREATE TRIGGER trg_mouvement_magasin_coherence
  BEFORE INSERT ON mouvements_caisse
  FOR EACH ROW EXECUTE FUNCTION enforce_mouvement_magasin_coherence();

-- ============================================================
-- 3. Audit view: unified ledger of acomptes + paiements vs caisse
-- ============================================================
CREATE OR REPLACE VIEW v_caisse_audit AS
SELECT
  'acompte_client'::TEXT          AS source_kind,
  a.id                            AS source_id,
  a.tiers_id,
  a.montant,
  a.methode_paiement,
  a.date_acompte                  AS source_date,
  a.session_caisse_id,
  a.mouvement_caisse_id,
  a.magasin_id,
  CASE
    WHEN a.methode_paiement = 'espece' AND a.mouvement_caisse_id IS NULL THEN TRUE
    ELSE FALSE
  END                             AS is_orphan
FROM acomptes_clients a
WHERE a.deleted_at IS NULL

UNION ALL

SELECT
  'acompte_fournisseur'::TEXT,
  af.id,
  af.tiers_id,
  af.montant,
  af.methode_paiement,
  af.date_acompte,
  af.session_caisse_id,
  af.mouvement_caisse_id,
  af.magasin_id,
  CASE
    WHEN af.methode_paiement = 'espece' AND af.mouvement_caisse_id IS NULL THEN TRUE
    ELSE FALSE
  END
FROM acomptes_fournisseur af
WHERE af.deleted_at IS NULL

UNION ALL

SELECT
  'paiement'::TEXT,
  p.id,
  f.tiers_id,
  p.montant,
  p.methode_paiement,
  p.date_paiement,
  p.session_caisse_id,
  p.mouvement_caisse_id,
  NULL::INTEGER                   AS magasin_id,
  CASE
    WHEN p.methode_paiement = 'espece'
      AND p.source = 'direct'
      AND p.mouvement_caisse_id IS NULL THEN TRUE
    ELSE FALSE
  END
FROM paiements p
JOIN factures f ON p.facture_id = f.id
WHERE p.deleted_at IS NULL;

COMMENT ON VIEW v_caisse_audit IS
  'Unified ledger: every money-in/out source. is_orphan=true → cash event missing mouvements_caisse link.';

-- ============================================================
-- 4. Quick orphan check query (informational)
-- ============================================================
-- SELECT source_kind, COUNT(*) FROM v_caisse_audit WHERE is_orphan GROUP BY source_kind;
