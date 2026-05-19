-- Migration: Fix DB conversion functions to use nextval for consistent numbering
-- Up: replace MAX(SUBSTRING...) with nextval('facture_numero_seq')
-- Down: restore old MAX(SUBSTRING...) pattern

-- ============================================================
-- UP: Update convert_devis_to_facture
-- ============================================================
CREATE OR REPLACE FUNCTION convert_devis_to_facture(p_devis_id INTEGER, p_user_id INTEGER)
RETURNS INTEGER AS $$
DECLARE
  v_devis RECORD;
  v_facture_id INTEGER;
  v_numero_facture VARCHAR(50);
  v_ligne RECORD;
  v_next_val INTEGER;
BEGIN
  SELECT * INTO v_devis FROM devis WHERE id = p_devis_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devis % not found', p_devis_id;
  END IF;

  IF v_devis.statut != 'accepte' THEN
    RAISE EXCEPTION 'Devis must be accepted before conversion. Current statut: %', v_devis.statut;
  END IF;

  -- Use sequence for consistent FAC-YYYY-##### format
  SELECT nextval('facture_numero_seq') INTO v_next_val;
  v_numero_facture := 'FAC-' || EXTRACT(YEAR FROM CURRENT_DATE) || '-' || LPAD(v_next_val::TEXT, 5, '0');

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
    'net_30',
    false
  ) RETURNING id INTO v_facture_id;

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

  UPDATE devis SET statut = 'converti', facture_id = v_facture_id WHERE id = p_devis_id;

  RETURN v_facture_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- UP: Update convert_bl_to_facture
-- ============================================================
CREATE OR REPLACE FUNCTION convert_bl_to_facture(p_bl_id INTEGER, p_user_id INTEGER)
RETURNS INTEGER AS $$
DECLARE
  v_bl RECORD;
  v_facture_id INTEGER;
  v_numero_facture VARCHAR(50);
  v_ligne RECORD;
  v_next_val INTEGER;
BEGIN
  SELECT * INTO v_bl FROM bons_livraison WHERE id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bon de livraison % not found', p_bl_id;
  END IF;

  -- Use sequence for consistent FAC-YYYY-##### format
  SELECT nextval('facture_numero_seq') INTO v_next_val;
  v_numero_facture := 'FAC-' || EXTRACT(YEAR FROM CURRENT_DATE) || '-' || LPAD(v_next_val::TEXT, 5, '0');

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

  UPDATE bons_livraison SET statut = 'facture', facture_id = v_facture_id WHERE id = p_bl_id;

  RETURN v_facture_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- UP: Also fix create_avoir_from_retour numbering
-- ============================================================
CREATE OR REPLACE FUNCTION create_avoir_from_retour(p_retour_id INTEGER, p_user_id INTEGER)
RETURNS INTEGER AS $$
DECLARE
  v_retour RECORD;
  v_avoir_id INTEGER;
  v_numero_avoir VARCHAR(50);
  v_next_val INTEGER;
  v_total_ht NUMERIC(15, 2);
  v_total_tva NUMERIC(15, 2);
  v_ligne RECORD;
BEGIN
  SELECT * INTO v_retour FROM retours WHERE id = p_retour_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Retour % not found', p_retour_id;
  END IF;

  IF v_retour.statut != 'valide' THEN
    RAISE EXCEPTION 'Retour must be validated before creating credit note. Current statut: %', v_retour.statut;
  END IF;

  -- Use sequence for consistent AVOIR-YYYY-##### format
  SELECT nextval('avoir_seq') INTO v_next_val;
  v_numero_avoir := 'AVOIR-' || EXTRACT(YEAR FROM CURRENT_DATE) || '-' || LPAD(v_next_val::TEXT, 5, '0');

  v_total_ht := COALESCE(v_retour.total, 0);
  v_total_tva := v_total_ht * 0.19;

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
    v_total_tva,
    v_total_ht,
    v_total_ht,
    v_total_ht + v_total_tva,
    'valide',
    'retour',
    'Avoir généré automatiquement depuis le retour ' || v_retour.numero_retour,
    p_user_id
  ) RETURNING id INTO v_avoir_id;

  FOR v_ligne IN SELECT * FROM retour_lignes WHERE retour_id = p_retour_id LOOP
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
