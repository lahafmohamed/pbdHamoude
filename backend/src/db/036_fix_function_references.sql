-- Fix: ensure conversion functions use document_lignes instead of old tables
-- that may have been dropped by migration 032.

-- convert_devis_to_facture
CREATE OR REPLACE FUNCTION convert_devis_to_facture(p_devis_id INTEGER, p_user_id INTEGER)
RETURNS INTEGER AS $$
DECLARE
    v_devis RECORD;
    v_facture_id INTEGER;
    v_numero_facture VARCHAR(50);
    v_next_val INTEGER;
    v_ligne RECORD;
BEGIN
    SELECT * INTO v_devis FROM devis WHERE id = p_devis_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Devis % not found', p_devis_id;
    END IF;

    IF v_devis.facture_id IS NOT NULL THEN
        RETURN v_devis.facture_id;
    END IF;

    SELECT COALESCE(MAX(CAST(SUBSTRING(numero_facture FROM 4) AS INTEGER)), 0) + 1
    INTO v_next_val
    FROM factures
    WHERE numero_facture ~ '^FAC-[0-9]{4}-[0-9]+$';

    v_numero_facture := 'FAC-' || EXTRACT(YEAR FROM CURRENT_DATE) || '-' || LPAD(v_next_val::TEXT, 5, '0');

    INSERT INTO factures (
        numero_facture,
        client_id,
        devis_id,
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
        p_devis_id,
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

-- convert_bl_to_facture
CREATE OR REPLACE FUNCTION convert_bl_to_facture(p_bl_id INTEGER, p_user_id INTEGER)
RETURNS INTEGER AS $$
DECLARE
    v_bl RECORD;
    v_facture_id INTEGER;
    v_numero_facture VARCHAR(50);
    v_next_val INTEGER;
    v_ligne RECORD;
BEGIN
    SELECT * INTO v_bl FROM bons_livraison WHERE id = p_bl_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bon de livraison % not found', p_bl_id;
    END IF;

    IF v_bl.facture_id IS NOT NULL THEN
        RETURN v_bl.facture_id;
    END IF;

    SELECT COALESCE(MAX(CAST(SUBSTRING(numero_facture FROM 4) AS INTEGER)), 0) + 1
    INTO v_next_val
    FROM factures
    WHERE numero_facture ~ '^FAC-[0-9]{4}-[0-9]+$';

    v_numero_facture := 'FAC-' || EXTRACT(YEAR FROM CURRENT_DATE) || '-' || LPAD(v_next_val::TEXT, 5, '0');

    INSERT INTO factures (
        numero_facture,
        client_id,
        bl_id,
        devis_id,
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
        v_bl.client_id,
        p_bl_id,
        v_bl.devis_id,
        CURRENT_TIMESTAMP,
        v_bl.sous_total,
        v_bl.tva,
        v_bl.total,
        v_bl.notes,
        v_bl.location_id,
        'net_30',
        false
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

-- convert_devis_to_bl
CREATE OR REPLACE FUNCTION convert_devis_to_bl(p_devis_id INTEGER, p_user_id INTEGER)
RETURNS INTEGER AS $$
DECLARE
    v_devis RECORD;
    v_bl_id INTEGER;
    v_numero_bl VARCHAR(50);
    v_next_val INTEGER;
    v_ligne RECORD;
BEGIN
    SELECT * INTO v_devis FROM devis WHERE id = p_devis_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Devis % not found', p_devis_id;
    END IF;

    SELECT COALESCE(MAX(CAST(SUBSTRING(numero_bl FROM 4) AS INTEGER)), 0) + 1
    INTO v_next_val
    FROM bons_livraison WHERE numero_bl LIKE 'BL-%';

    v_numero_bl := 'BL-' || LPAD(v_next_val::TEXT, 6, '0');

    INSERT INTO bons_livraison (
        numero_bl,
        client_id,
        devis_id,
        date_bl,
        sous_total,
        tva,
        total,
        notes,
        location_id,
        cree_par
    ) VALUES (
        v_numero_bl,
        v_devis.client_id,
        p_devis_id,
        CURRENT_DATE,
        v_devis.sous_total,
        v_devis.tva,
        v_devis.total,
        v_devis.notes,
        v_devis.location_id,
        p_user_id
    ) RETURNING id INTO v_bl_id;

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
            quantite_livree,
            prix_unitaire,
            total_ligne,
            parent_ligne_id
        ) VALUES (
            'bl',
            v_bl_id,
            v_ligne.produit_id,
            v_ligne.description,
            v_ligne.quantite,
            v_ligne.quantite,
            v_ligne.prix_unitaire,
            v_ligne.total_ligne,
            v_ligne.id
        );
    END LOOP;

    UPDATE devis SET statut = 'accepte' WHERE id = p_devis_id;

    RETURN v_bl_id;
END;
$$ LANGUAGE plpgsql;
