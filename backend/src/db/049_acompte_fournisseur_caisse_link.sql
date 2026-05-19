-- ============================================================
-- 049_acompte_fournisseur_caisse_link.sql
-- Symmetric caisse linkage for acomptes_fournisseur
-- Mirrors acomptes_clients caisse-link columns (mig 048)
-- ============================================================

-- 1. Add caisse linkage columns + idempotency + audit fields
ALTER TABLE acomptes_fournisseur
  ADD COLUMN IF NOT EXISTS magasin_id           INTEGER REFERENCES magasins(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS session_caisse_id    INTEGER REFERENCES sessions_caisse(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mouvement_caisse_id  INTEGER REFERENCES mouvements_caisse(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS montant_restant      NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS idempotency_key      VARCHAR(80),
  ADD COLUMN IF NOT EXISTS reference_number     VARCHAR(100),
  ADD COLUMN IF NOT EXISTS rembourse_par_user_id INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS date_remboursement   TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS deleted_at           TIMESTAMP;

-- 2. Backfill montant_restant from statut
UPDATE acomptes_fournisseur
SET montant_restant = CASE
  WHEN statut = 'disponible' THEN montant
  WHEN statut IN ('utilise','rembourse') THEN 0
  ELSE montant
END
WHERE montant_restant IS NULL;

ALTER TABLE acomptes_fournisseur
  ALTER COLUMN montant_restant SET NOT NULL;

-- 3. Extend statut enum to match acomptes_clients
ALTER TABLE acomptes_fournisseur DROP CONSTRAINT IF EXISTS acomptes_fournisseur_statut_check;
ALTER TABLE acomptes_fournisseur
  ADD CONSTRAINT acomptes_fournisseur_statut_check
  CHECK (statut IN ('disponible','partiellement_utilise','utilise','rembourse'));

-- 4. Indexes
CREATE UNIQUE INDEX IF NOT EXISTS uq_acomptes_fourn_idempotency
  ON acomptes_fournisseur(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_acomptes_fourn_restant
  ON acomptes_fournisseur(tiers_id, statut)
  WHERE deleted_at IS NULL AND montant_restant > 0;

CREATE INDEX IF NOT EXISTS idx_acomptes_fourn_session
  ON acomptes_fournisseur(session_caisse_id)
  WHERE session_caisse_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_acomptes_fourn_mouvement
  ON acomptes_fournisseur(mouvement_caisse_id)
  WHERE mouvement_caisse_id IS NOT NULL;

-- 5. Backfill mouvement_caisse_id from existing mouvements_caisse rows
--    where reference_type='acompte_fournisseur' (best-effort historic link).
--    Older rows used reference_type='acompte' which is shared with client acomptes;
--    we only backfill the unambiguous fournisseur tag.
UPDATE acomptes_fournisseur af
SET mouvement_caisse_id = mc.id,
    session_caisse_id   = COALESCE(af.session_caisse_id, mc.session_caisse_id),
    magasin_id          = COALESCE(af.magasin_id, mc.magasin_id)
FROM mouvements_caisse mc
WHERE mc.reference_type = 'acompte_fournisseur'
  AND mc.reference_id = af.id
  AND af.mouvement_caisse_id IS NULL;

-- 6. Extend mouvements_caisse.reference_type to distinguish supplier acompte
--    from supplier-invoice payment. Existing 'acompte' tag is ambiguous (shared
--    with client acomptes via reference_id collision).
ALTER TABLE mouvements_caisse DROP CONSTRAINT IF EXISTS mouvements_caisse_reference_type_check;
ALTER TABLE mouvements_caisse
  ADD CONSTRAINT mouvements_caisse_reference_type_check
  CHECK (reference_type IN (
    'paiement','acompte','acompte_fournisseur','depense',
    'paiement_fournisseur','avoir','apport','retrait'
  ));

-- 7. Integrity: cross-row magasin coherence enforced at app layer + session FK
--    (full CHECK requires trigger — matches acomptes_clients convention)

COMMENT ON COLUMN acomptes_fournisseur.mouvement_caisse_id IS
  'Link to mouvements_caisse row created when acompte paid in cash. NULL for non-cash methods.';
COMMENT ON COLUMN acomptes_fournisseur.session_caisse_id IS
  'Session caisse open at time of cash acompte creation.';
