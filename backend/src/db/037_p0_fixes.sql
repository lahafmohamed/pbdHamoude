-- Migration 037: P0 fixes
-- 1. Add 'transfert' to mouvements_stock type_mouvement
-- 2. Fix create_avoir_from_retour to not hardcode 0.19 TVA (business uses 0% TVA)

-- ============================================================
-- 1. EXTEND mouvements_stock TYPE ENUM
-- ============================================================

ALTER TABLE mouvements_stock
  DROP CONSTRAINT IF EXISTS mouvements_stock_type_mouvement_check;

ALTER TABLE mouvements_stock
  ADD CONSTRAINT mouvements_stock_type_mouvement_check
  CHECK (type_mouvement IN ('vente', 'ajustement', 'retour', 'commande', 'perte', 'autre', 'transfert'));

-- ============================================================
-- 2. FIX create_avoir_from_retour: remove hardcoded 0.19 TVA
--    Business constraint: factures.tva = 0, avoirs must match
-- ============================================================

CREATE OR REPLACE FUNCTION create_avoir_from_retour(p_retour_id INTEGER, p_user_id INTEGER)
RETURNS INTEGER AS $$
DECLARE
  v_retour RECORD;
  v_avoir_id INTEGER;
  v_numero_avoir VARCHAR(50);
  v_next_val INTEGER;
  v_total_ht NUMERIC(15, 2);
  v_ligne RECORD;
BEGIN
  SELECT * INTO v_retour FROM retours WHERE id = p_retour_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Retour % not found', p_retour_id;
  END IF;

  IF v_retour.statut NOT IN ('valide', 'traite') THEN
    RAISE EXCEPTION 'Retour must be validated/processed before creating credit note. Current statut: %', v_retour.statut;
  END IF;

  SELECT nextval('avoir_seq') INTO v_next_val;
  v_numero_avoir := 'AVOIR-' || EXTRACT(YEAR FROM CURRENT_DATE) || '-' || LPAD(v_next_val::TEXT, 5, '0');

  -- Calculate total from lines; TVA = 0 per business constraint
  v_total_ht := COALESCE(v_retour.total_remboursement, 0);

  INSERT INTO factures_avoir (
    numero_avoir,
    client_id,
    retour_id,
    date_avoir,
    sous_total,
    tva,
    total,
    total_ht,
    total_ttc,
    statut,
    avoir_type,
    notes,
    cree_par
  ) VALUES (
    v_numero_avoir,
    v_retour.client_id,
    p_retour_id,
    CURRENT_DATE,
    v_total_ht,
    0,           -- TVA = 0 per business constraint (migration 027)
    v_total_ht,
    v_total_ht,
    v_total_ht,  -- total_ttc = total_ht when TVA = 0
    'valide',
    'retour',
    'Avoir généré automatiquement depuis le retour ' || v_retour.numero_retour,
    p_user_id
  ) RETURNING id INTO v_avoir_id;

  FOR v_ligne IN
    SELECT rl.*, p.nom as produit_nom
    FROM retour_lignes rl
    LEFT JOIN produits p ON p.id = rl.produit_id
    WHERE rl.retour_id = p_retour_id
  LOOP
    INSERT INTO facture_avoir_lignes (
      avoir_id,
      produit_id,
      description,
      quantite,
      prix_unitaire,
      total_ligne
    ) VALUES (
      v_avoir_id,
      v_ligne.produit_id,
      v_ligne.produit_nom,
      v_ligne.quantite,
      v_ligne.prix_unitaire,
      v_ligne.quantite * v_ligne.prix_unitaire
    );
  END LOOP;

  RETURN v_avoir_id;
END;
$$ LANGUAGE plpgsql;
