-- Migration: Unify 4 separate line-item tables into one document_lignes table
-- User authorized data deletion for simplicity.
-- DOWN: recreate old tables (empty) — rollback is structural only.

-- ============================================================
-- UP
-- ============================================================

-- Drop old line-item tables
DROP TABLE IF EXISTS facture_lignes CASCADE;
DROP TABLE IF EXISTS devis_lignes CASCADE;
DROP TABLE IF EXISTS bon_livraison_lignes CASCADE;
DROP TABLE IF EXISTS facture_avoir_lignes CASCADE;

-- Create unified document_lignes table
CREATE TABLE document_lignes (
  id SERIAL PRIMARY KEY,
  document_type VARCHAR(20) NOT NULL CHECK (document_type IN ('facture','devis','bl','avoir')),
  document_id INTEGER NOT NULL,
  produit_id INTEGER REFERENCES produits(id) ON DELETE SET NULL,
  description VARCHAR(255),
  quantite INTEGER NOT NULL DEFAULT 1 CHECK (quantite > 0),
  quantite_livree INTEGER,          -- used by BL
  prix_unitaire NUMERIC(15, 2) NOT NULL,
  remise_pct NUMERIC(5, 2) DEFAULT 0,
  remise_montant NUMERIC(15, 2) DEFAULT 0,
  total_ligne NUMERIC(15, 2) NOT NULL,
  parent_ligne_id INTEGER REFERENCES document_lignes(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_document_lignes_lookup ON document_lignes(document_type, document_id);
CREATE INDEX idx_document_lignes_produit ON document_lignes(produit_id);

-- Update conversion functions to use unified table

-- convert_devis_to_facture
CREATE OR REPLACE FUNCTION convert_devis_to_facture(p_devis_id INTEGER, p_user_id INTEGER)
RETURNS INTEGER AS $$
DECLARE
  v_devis RECORD;
  v_facture_id INTEGER;
  v_numero_facture VARCHAR(50);
  v_ligne RECORD;
  v_next_val INTEGER;
BEGIN
  SELECT * INTO v_devis FROM devis WHERE id = p_devis_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devis % not found', p_devis_id;
  END IF;

  IF v_devis.statut != 'accepte' THEN
    RAISE EXCEPTION 'Devis must be accepted before conversion. Current statut: %', v_devis.statut;
  END IF;

  SELECT nextval('facture_numero_seq') INTO v_next_val;
  v_numero_facture := 'FAC-' || EXTRACT(YEAR FROM CURRENT_DATE) || '-' || LPAD(v_next_val::TEXT, 5, '0');

  INSERT INTO factures (
    numero_facture, client_id, date_facture, sous_total, tva, total,
    notes, location_id, delai_paiement, hors_taxe
  ) VALUES (
    v_numero_facture, v_devis.client_id, CURRENT_TIMESTAMP,
    v_devis.sous_total, v_devis.tva, v_devis.total,
    v_devis.notes, v_devis.location_id, 'net_30', false
  ) RETURNING id INTO v_facture_id;

  FOR v_ligne IN
    SELECT * FROM document_lignes
    WHERE document_type = 'devis' AND document_id = p_devis_id
  LOOP
    INSERT INTO document_lignes (
      document_type, document_id, produit_id, description, quantite,
      prix_unitaire, total_ligne, parent_ligne_id
    ) VALUES (
      'facture', v_facture_id, v_ligne.produit_id, v_ligne.description,
      v_ligne.quantite, v_ligne.prix_unitaire, v_ligne.total_ligne, v_ligne.id
    );
  END LOOP;

  UPDATE devis SET statut = 'converti', facture_id = v_facture_id WHERE id = p_devis_id;

  RETURN v_facture_id;
END;
$$ LANGUAGE plpgsql;

-- convert_bl_to_facture
CREATE OR REPLACE FUNCTION convert_bl_to_facture(p_bl_id INTEGER, p_user_id INTEGER)
RETURNS INTEGER AS $$
DECLARE
  v_bl RECORD;
  v_facture_id INTEGER;
  v_numero_facture VARCHAR(50);
  v_ligne RECORD;
  v_next_val INTEGER;
BEGIN
  SELECT * INTO v_bl FROM bons_livraison WHERE id = p_bl_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bon de livraison % not found', p_bl_id;
  END IF;

  SELECT nextval('facture_numero_seq') INTO v_next_val;
  v_numero_facture := 'FAC-' || EXTRACT(YEAR FROM CURRENT_DATE) || '-' || LPAD(v_next_val::TEXT, 5, '0');

  INSERT INTO factures (
    numero_facture, client_id, date_facture, sous_total, tva, total,
    montant_paye, remaining_due, statut, notes, location_id
  ) VALUES (
    v_numero_facture, v_bl.client_id, CURRENT_TIMESTAMP,
    v_bl.sous_total, v_bl.tva, v_bl.total,
    0, v_bl.total, 'en_attente', v_bl.notes, v_bl.location_id
  ) RETURNING id INTO v_facture_id;

  FOR v_ligne IN
    SELECT * FROM document_lignes
    WHERE document_type = 'bl' AND document_id = p_bl_id
  LOOP
    INSERT INTO document_lignes (
      document_type, document_id, produit_id, description, quantite,
      prix_unitaire, total_ligne, parent_ligne_id
    ) VALUES (
      'facture', v_facture_id, v_ligne.produit_id, v_ligne.description,
      COALESCE(v_ligne.quantite_livree, v_ligne.quantite),
      v_ligne.prix_unitaire, v_ligne.total_ligne, v_ligne.id
    );
  END LOOP;

  UPDATE bons_livraison SET statut = 'facture', facture_id = v_facture_id WHERE id = p_bl_id;

  RETURN v_facture_id;
END;
$$ LANGUAGE plpgsql;

-- convert_devis_to_bl
CREATE OR REPLACE FUNCTION convert_devis_to_bl(p_devis_id INTEGER, p_user_id INTEGER)
RETURNS INTEGER AS $$
DECLARE
  v_devis RECORD;
  v_bl_id INTEGER;
  v_numero_bl VARCHAR(50);
  v_ligne RECORD;
  v_next_val INTEGER;
BEGIN
  SELECT * INTO v_devis FROM devis WHERE id = p_devis_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devis % not found', p_devis_id;
  END IF;

  SELECT nextval('bl_seq') INTO v_next_val;
  v_numero_bl := 'BL-' || EXTRACT(YEAR FROM CURRENT_DATE) || '-' || LPAD(v_next_val::TEXT, 5, '0');

  INSERT INTO bons_livraison (
    numero_bl, client_id, devis_id, date_bl, sous_total, tva, total,
    notes, location_id, statut, cree_par
  ) VALUES (
    v_numero_bl, v_devis.client_id, p_devis_id, CURRENT_DATE,
    v_devis.sous_total, v_devis.tva, v_devis.total,
    v_devis.notes, v_devis.location_id, 'valide', p_user_id
  ) RETURNING id INTO v_bl_id;

  FOR v_ligne IN
    SELECT * FROM document_lignes
    WHERE document_type = 'devis' AND document_id = p_devis_id
  LOOP
    INSERT INTO document_lignes (
      document_type, document_id, produit_id, description, quantite, quantite_livree,
      prix_unitaire, total_ligne, parent_ligne_id
    ) VALUES (
      'bl', v_bl_id, v_ligne.produit_id, v_ligne.description,
      v_ligne.quantite, v_ligne.quantite,
      v_ligne.prix_unitaire, v_ligne.total_ligne, v_ligne.id
    );
  END LOOP;

  UPDATE devis SET statut = 'accepte' WHERE id = p_devis_id;

  RETURN v_bl_id;
END;
$$ LANGUAGE plpgsql;

-- create_avoir_from_retour (keep retour_lignes, but write to unified table)
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

  SELECT nextval('avoir_seq') INTO v_next_val;
  v_numero_avoir := 'AVOIR-' || EXTRACT(YEAR FROM CURRENT_DATE) || '-' || LPAD(v_next_val::TEXT, 5, '0');

  v_total_ht := COALESCE(v_retour.total, 0);
  v_total_tva := v_total_ht * 0.19;

  INSERT INTO factures_avoir (
    numero_avoir, client_id, retour_id, date_avoir, sous_total, tva, total,
    total_ht, total_ttc, statut, avoir_type, notes, cree_par
  ) VALUES (
    v_numero_avoir, v_retour.client_id, p_retour_id, CURRENT_DATE,
    v_total_ht, v_total_tva, v_total_ht,
    v_total_ht, v_total_ht + v_total_tva, 'valide', 'retour',
    'Avoir généré automatiquement depuis le retour ' || v_retour.numero_retour,
    p_user_id
  ) RETURNING id INTO v_avoir_id;

  FOR v_ligne IN SELECT * FROM retour_lignes WHERE retour_id = p_retour_id LOOP
    INSERT INTO document_lignes (
      document_type, document_id, produit_id, description, quantite,
      prix_unitaire, total_ligne
    ) VALUES (
      'avoir', v_avoir_id, v_ligne.produit_id, v_ligne.produit_nom,
      v_ligne.quantite, v_ligne.prix_unitaire,
      v_ligne.quantite * v_ligne.prix_unitaire
    );
  END LOOP;

  RETURN v_avoir_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- DOWN (structural rollback — data is gone)
-- ============================================================
-- Recreate old empty tables (no data recovery)
-- DROP TABLE IF EXISTS document_lignes CASCADE;
-- CREATE TABLE facture_lignes (...);
-- CREATE TABLE devis_lignes (...);
-- CREATE TABLE bon_livraison_lignes (...);
-- CREATE TABLE facture_avoir_lignes (...);
