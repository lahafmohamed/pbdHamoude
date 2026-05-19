--
-- PostgreSQL database dump
--

\restrict jo2T02qGMVeznCHVIbthgDbCMugArp4IZVuLGfk45IUxmY0gLr7ldzRw6aJt6JW

-- Dumped from database version 18.3
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: transfer_statut_new; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.transfer_statut_new AS ENUM (
    'en_preparation',
    'en_cours',
    'livre',
    'annule'
);


ALTER TYPE public.transfer_statut_new OWNER TO postgres;

--
-- Name: adjust_stock_at_location(integer, integer, integer, character varying); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.adjust_stock_at_location(p_produit_id integer, p_location_id integer, p_quantity integer, p_operation character varying) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_current_stock INTEGER;
  v_new_stock INTEGER;
BEGIN
  -- Get current stock at location
  SELECT COALESCE(quantite, 0) INTO v_current_stock
  FROM stock_par_location
  WHERE produit_id = p_produit_id AND location_id = p_location_id;
  
  -- Calculate new stock
  IF p_operation = 'add' THEN
    v_new_stock := v_current_stock + p_quantity;
  ELSIF p_operation = 'remove' THEN
    IF v_current_stock < p_quantity THEN
      RAISE EXCEPTION 'Insufficient stock at location % for product %', p_location_id, p_produit_id;
    END IF;
    v_new_stock := v_current_stock - p_quantity;
  ELSE
    RAISE EXCEPTION 'Invalid operation: %', p_operation;
  END IF;
  
  -- Update or insert
  INSERT INTO stock_par_location (produit_id, location_id, quantite)
  VALUES (p_produit_id, p_location_id, v_new_stock)
  ON CONFLICT (produit_id, location_id) 
  DO UPDATE SET quantite = v_new_stock;
END;
$$;


ALTER FUNCTION public.adjust_stock_at_location(p_produit_id integer, p_location_id integer, p_quantity integer, p_operation character varying) OWNER TO postgres;

--
-- Name: calculer_solde_client(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.calculer_solde_client(p_tiers_id integer) RETURNS numeric
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.calculer_solde_client(p_tiers_id integer) OWNER TO postgres;

--
-- Name: calculer_solde_fournisseur(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.calculer_solde_fournisseur(p_tiers_id integer) RETURNS numeric
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.calculer_solde_fournisseur(p_tiers_id integer) OWNER TO postgres;

--
-- Name: calculer_solde_net(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.calculer_solde_net(p_tiers_id integer) RETURNS numeric
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN calculer_solde_client(p_tiers_id) - calculer_solde_fournisseur(p_tiers_id);
END;
$$;


ALTER FUNCTION public.calculer_solde_net(p_tiers_id integer) OWNER TO postgres;

--
-- Name: check_allocation_consistency(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.check_allocation_consistency(client_id_param integer DEFAULT NULL::integer) RETURNS TABLE(client_id integer, total_factures numeric, total_paiements numeric, total_alloue numeric, surplus numeric, inconsistent_factures bigint)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    WITH 
    client_data AS (
        SELECT 
            COALESCE(client_id_param, f.client_id) as client_id,
            COALESCE(SUM(f.total), 0) as total_factures,
            COALESCE(SUM(p.montant), 0) as total_paiements,
            COALESCE(SUM(f.montant_paye), 0) as total_alloue,
            COALESCE(SUM(p.montant), 0) - COALESCE(SUM(f.montant_paye), 0) as surplus
        FROM factures f
        LEFT JOIN paiements p ON p.facture_id = f.id
        WHERE f.deleted_at IS NULL 
        AND (client_id_param IS NULL OR f.client_id = client_id_param)
        GROUP BY COALESCE(client_id_param, f.client_id)
    ),
    inconsistent AS (
        SELECT 
            f.client_id,
            COUNT(*) as inconsistent_count
        FROM factures f
        WHERE f.deleted_at IS NULL
        AND ABS((f.total - f.montant_paye) - f.remaining_due) > 0.01
        AND (client_id_param IS NULL OR f.client_id = client_id_param)
        GROUP BY f.client_id
    )
    SELECT 
        cd.client_id,
        cd.total_factures,
        cd.total_paiements,
        cd.total_alloue,
        cd.surplus,
        COALESCE(i.inconsistent_count, 0) as inconsistent_factures
    FROM client_data cd
    LEFT JOIN inconsistent i ON i.client_id = cd.client_id;
END;
$$;


ALTER FUNCTION public.check_allocation_consistency(client_id_param integer) OWNER TO postgres;

--
-- Name: convert_bl_to_facture(integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.convert_bl_to_facture(p_bl_id integer, p_user_id integer) RETURNS integer
    LANGUAGE plpgsql
    AS $_$
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
          numero_facture, tiers_id, bl_id, devis_id,
          date_facture, sous_total, tva, total,
          montant_paye, remaining_due, statut, notes, location_id,
          delai_paiement, hors_taxe
        ) VALUES (
          v_numero_facture, v_bl.tiers_id, p_bl_id, v_bl.devis_id,
          CURRENT_TIMESTAMP, v_bl.sous_total, v_bl.tva, v_bl.total,
          0, v_bl.total, 'en_attente', v_bl.notes, v_bl.location_id,
          'net_30', false
        ) RETURNING id INTO v_facture_id;

        FOR v_ligne IN
          SELECT * FROM document_lignes
          WHERE document_type = 'bl' AND document_id = p_bl_id
        LOOP
          INSERT INTO document_lignes (
            document_type, document_id, produit_id, description,
            quantite, prix_unitaire, total_ligne, parent_ligne_id
          ) VALUES (
            'facture', v_facture_id, v_ligne.produit_id, v_ligne.description,
            v_ligne.quantite, v_ligne.prix_unitaire, v_ligne.total_ligne, v_ligne.id
          );
        END LOOP;

        UPDATE bons_livraison SET statut = 'facture', facture_id = v_facture_id WHERE id = p_bl_id;

        RETURN v_facture_id;
      END;
      $_$;


ALTER FUNCTION public.convert_bl_to_facture(p_bl_id integer, p_user_id integer) OWNER TO postgres;

--
-- Name: convert_devis_to_bl(integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.convert_devis_to_bl(p_devis_id integer, p_user_id integer) RETURNS integer
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.convert_devis_to_bl(p_devis_id integer, p_user_id integer) OWNER TO postgres;

--
-- Name: convert_devis_to_facture(integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.convert_devis_to_facture(p_devis_id integer, p_user_id integer) RETURNS integer
    LANGUAGE plpgsql
    AS $_$
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
$_$;


ALTER FUNCTION public.convert_devis_to_facture(p_devis_id integer, p_user_id integer) OWNER TO postgres;

--
-- Name: create_avoir_from_retour(integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_avoir_from_retour(p_retour_id integer, p_user_id integer) RETURNS integer
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.create_avoir_from_retour(p_retour_id integer, p_user_id integer) OWNER TO postgres;

--
-- Name: create_ecritures_facture_client(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_ecritures_facture_client() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.create_ecritures_facture_client() OWNER TO postgres;

--
-- Name: create_ecritures_facture_fournisseur(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_ecritures_facture_fournisseur() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.create_ecritures_facture_fournisseur() OWNER TO postgres;

--
-- Name: enforce_acompte_application_cap(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.enforce_acompte_application_cap() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_total_applied NUMERIC(15,2);
  v_montant_acompte NUMERIC(15,2);
BEGIN
  SELECT COALESCE(SUM(montant),0) INTO v_total_applied
    FROM acompte_applications WHERE acompte_id = NEW.acompte_id;
  SELECT montant INTO v_montant_acompte
    FROM acomptes_clients WHERE id = NEW.acompte_id;
  IF v_total_applied > v_montant_acompte THEN
    RAISE EXCEPTION 'Application dÃ©passe le montant de l''acompte (%/%)', v_total_applied, v_montant_acompte;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.enforce_acompte_application_cap() OWNER TO postgres;

--
-- Name: enforce_acompte_fournisseur_application_cap(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.enforce_acompte_fournisseur_application_cap() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.enforce_acompte_fournisseur_application_cap() OWNER TO postgres;

--
-- Name: enforce_mouvement_append_only(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.enforce_mouvement_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
      RAISE EXCEPTION 'Session % cloturÃ©e â€” impossible d''ajouter un mouvement', NEW.session_caisse_id;
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION public.enforce_mouvement_append_only() OWNER TO postgres;

--
-- Name: enforce_mouvement_magasin_coherence(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.enforce_mouvement_magasin_coherence() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.enforce_mouvement_magasin_coherence() OWNER TO postgres;

--
-- Name: enforce_paiement_espece_mouvement(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.enforce_paiement_espece_mouvement() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.enforce_paiement_espece_mouvement() OWNER TO postgres;

--
-- Name: FUNCTION enforce_paiement_espece_mouvement(); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.enforce_paiement_espece_mouvement() IS 'Deferred check: paiement espece+direct must end transaction with mouvement_caisse_id set. Fires at COMMIT only.';


--
-- Name: ensure_plan_compte(character varying, character varying, character varying, character varying); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.ensure_plan_compte(p_numero character varying, p_intitule character varying, p_type_compte character varying, p_categorie character varying) RETURNS integer
    LANGUAGE plpgsql
    AS $$
      DECLARE
        v_compte_id INTEGER;
      BEGIN
        SELECT id INTO v_compte_id
        FROM plan_comptable
        WHERE numero = p_numero;

        IF v_compte_id IS NULL THEN
          INSERT INTO plan_comptable (numero, intitule, type_compte, categorie)
          VALUES (p_numero, p_intitule, p_type_compte, p_categorie)
          ON CONFLICT (numero) DO UPDATE
            SET intitule = EXCLUDED.intitule,
                type_compte = EXCLUDED.type_compte,
                categorie = EXCLUDED.categorie
          RETURNING id INTO v_compte_id;
        END IF;

        RETURN v_compte_id;
      END;
      $$;


ALTER FUNCTION public.ensure_plan_compte(p_numero character varying, p_intitule character varying, p_type_compte character varying, p_categorie character varying) OWNER TO postgres;

--
-- Name: expire_old_lots(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.expire_old_lots() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE lots 
  SET statut = 'expire'
  WHERE date_expiration < CURRENT_DATE 
    AND statut = 'actif'
    AND quantite_restante > 0;
END;
$$;


ALTER FUNCTION public.expire_old_lots() OWNER TO postgres;

--
-- Name: generate_demande_numero(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.generate_demande_numero() RETURNS character varying
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_year INTEGER;
    v_seq INTEGER;
    v_numero VARCHAR(50);
BEGIN
    v_year := EXTRACT(YEAR FROM CURRENT_DATE);
    SELECT nextval('demande_reappro_numero_seq') INTO v_seq;
    v_numero := 'DEM-' || v_year || '-' || LPAD(v_seq::TEXT, 5, '0');
    RETURN v_numero;
END;
$$;


ALTER FUNCTION public.generate_demande_numero() OWNER TO postgres;

--
-- Name: FUNCTION generate_demande_numero(); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.generate_demande_numero() IS 'Generates atomic demande numbers (DEM-YYYY-NNNNN)';


--
-- Name: generate_tiers_code(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.generate_tiers_code() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    NEW.code := 'TI-' || LPAD(NEW.id::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.generate_tiers_code() OWNER TO postgres;

--
-- Name: get_stock_at_location(integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_stock_at_location(p_produit_id integer, p_location_id integer DEFAULT NULL::integer) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_stock INTEGER;
BEGIN
  IF p_location_id IS NULL THEN
    -- Get total across all active locations
    SELECT COALESCE(SUM(spl.quantite), 0) INTO v_stock
    FROM stock_par_location spl
    JOIN stock_locations sl ON spl.location_id = sl.id
    WHERE spl.produit_id = p_produit_id AND sl.actif = true;
  ELSE
    -- Get stock at specific location
    SELECT COALESCE(quantite, 0) INTO v_stock
    FROM stock_par_location
    WHERE produit_id = p_produit_id AND location_id = p_location_id;
  END IF;
  
  RETURN v_stock;
END;
$$;


ALTER FUNCTION public.get_stock_at_location(p_produit_id integer, p_location_id integer) OWNER TO postgres;

--
-- Name: get_user_default_location_id(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_user_default_location_id(p_user_id integer) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_location_id INTEGER;
BEGIN
    SELECT location_id INTO v_location_id FROM user_location_roles
    WHERE utilisateur_id = p_user_id AND est_defaut = true LIMIT 1;
    IF v_location_id IS NULL THEN
        SELECT location_id INTO v_location_id FROM user_location_roles
        WHERE utilisateur_id = p_user_id LIMIT 1;
    END IF;
    RETURN v_location_id;
END;
$$;


ALTER FUNCTION public.get_user_default_location_id(p_user_id integer) OWNER TO postgres;

--
-- Name: get_user_location_role(integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_user_location_role(p_user_id integer, p_location_id integer) RETURNS character varying
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_role VARCHAR(20);
    v_global_role VARCHAR(20);
BEGIN
    SELECT role::text INTO v_global_role FROM utilisateurs WHERE id = p_user_id;
    IF v_global_role = 'admin' THEN RETURN 'admin'; END IF;
    SELECT role_at_location INTO v_role FROM user_location_roles
    WHERE utilisateur_id = p_user_id AND location_id = p_location_id;
    IF v_role IS NULL THEN
        IF v_global_role = 'depot_staff' THEN
            SELECT CASE WHEN location_type = 'depot' THEN 'depot_staff' ELSE NULL END INTO v_role
            FROM stock_locations WHERE id = p_location_id;
        ELSIF v_global_role = 'magasin_staff' THEN
            SELECT CASE WHEN location_type = 'magasin' THEN 'magasin_staff' ELSE NULL END INTO v_role
            FROM stock_locations WHERE id = p_location_id;
        END IF;
    END IF;
    RETURN COALESCE(v_role, 'none');
END;
$$;


ALTER FUNCTION public.get_user_location_role(p_user_id integer, p_location_id integer) OWNER TO postgres;

--
-- Name: log_demande_state_change(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.log_demande_state_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Only log if status actually changed
    IF OLD.statut IS DISTINCT FROM NEW.statut THEN
        INSERT INTO demandes_reapprovisionnement_history (
            demande_id,
            from_statut,
            to_statut,
            user_id,
            payload
        ) VALUES (
            NEW.id,
            OLD.statut,
            NEW.statut,
            COALESCE(NEW.decided_by_user_id, NEW.executed_by_user_id, NEW.closed_by_user_id),
            jsonb_build_object(
                'decided_by_user_id', NEW.decided_by_user_id,
                'executed_by_user_id', NEW.executed_by_user_id,
                'closed_by_user_id', NEW.closed_by_user_id,
                'raison_refus', NEW.raison_refus,
                'transfert_id', NEW.transfert_id
            )
        );
    END IF;
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.log_demande_state_change() OWNER TO postgres;

--
-- Name: log_mouvement_stock(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.log_mouvement_stock() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- On log uniquement si le stock a changé
  IF OLD.stock IS DISTINCT FROM NEW.stock THEN
    INSERT INTO mouvements_stock (produit_id, type_mouvement, quantite, stock_avant, stock_apres, raison)
    VALUES (
      NEW.id,
      'ajustement',
      NEW.stock - OLD.stock,
      OLD.stock,
      NEW.stock,
      'Mise à jour manuelle'
    );
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.log_mouvement_stock() OWNER TO postgres;

--
-- Name: rollback_fifo_allocation(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.rollback_fifo_allocation() RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
    backup_count INTEGER;
BEGIN
    -- This function would restore the previous allocation logic
    -- For now, we just reset allocation_version to 0
    UPDATE factures SET allocation_version = 0 WHERE deleted_at IS NULL;
    
    GET DIAGNOSTICS backup_count = ROW_COUNT;
    
    RETURN CONCAT('Rollback completed. ', backup_count, ' factures reset to allocation version 0.');
END;
$$;


ALTER FUNCTION public.rollback_fifo_allocation() OWNER TO postgres;

--
-- Name: sync_acompte_after_application(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sync_acompte_after_application() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.sync_acompte_after_application() OWNER TO postgres;

--
-- Name: sync_acompte_fournisseur_state(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sync_acompte_fournisseur_state() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.sync_acompte_fournisseur_state() OWNER TO postgres;

--
-- Name: sync_demande_on_transfer_change(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sync_demande_on_transfer_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.statut::text = 'livre' AND OLD.statut::text != 'livre' AND NEW.demande_id IS NOT NULL THEN
        UPDATE demandes_reapprovisionnement
        SET statut = 'livree', date_livraison = CURRENT_TIMESTAMP
        WHERE id = NEW.demande_id AND statut = 'en_cours';
    END IF;
    IF NEW.demande_id IS NOT NULL AND TG_OP = 'INSERT' THEN
        UPDATE demandes_reapprovisionnement
        SET statut = 'en_cours', transfert_id = NEW.id, date_execution = CURRENT_TIMESTAMP
        WHERE id = NEW.demande_id AND statut IN ('approuvee', 'partiellement_approuvee');
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.sync_demande_on_transfer_change() OWNER TO postgres;

--
-- Name: transferer_fonds_caisse(integer, integer, numeric, integer, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.transferer_fonds_caisse(p_caisse_source_id integer, p_caisse_dest_id integer, p_montant numeric, p_user_id integer, p_notes text DEFAULT NULL::text) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_transfert_id INTEGER;
  v_numero_transfert VARCHAR(50);
  v_next_val INTEGER;
  v_source_solde NUMERIC;
BEGIN
  -- Check source balance
  SELECT solde_actuel INTO v_source_solde FROM caisses WHERE id = p_caisse_source_id;
  
  IF v_source_solde < p_montant THEN
    RAISE EXCEPTION 'Insufficient funds in source caisse. Available: %, Requested: %', v_source_solde, p_montant;
  END IF;
  
  -- Generate transfer number
  SELECT COALESCE(MAX(CAST(SUBSTRING(numero_transfert FROM 4) AS INTEGER)), 0) + 1 
  INTO v_next_val FROM transferts_caisse WHERE numero_transfert LIKE 'TC-%';
  
  v_numero_transfert := 'TC-' || LPAD(v_next_val::TEXT, 6, '0');
  
  -- Create transfer record
  INSERT INTO transferts_caisse (
    numero_transfert,
    caisse_source_id,
    caisse_dest_id,
    montant,
    statut,
    cree_par,
    notes
  ) VALUES (
    v_numero_transfert,
    p_caisse_source_id,
    p_caisse_dest_id,
    p_montant,
    'valide',
    p_user_id,
    p_notes
  ) RETURNING id INTO v_transfert_id;
  
  -- Update caisse balances
  UPDATE caisses 
  SET solde_actuel = solde_actuel - p_montant 
  WHERE id = p_caisse_source_id;
  
  UPDATE caisses 
  SET solde_actuel = solde_actuel + p_montant 
  WHERE id = p_caisse_dest_id;
  
  RETURN v_transfert_id;
END;
$$;


ALTER FUNCTION public.transferer_fonds_caisse(p_caisse_source_id integer, p_caisse_dest_id integer, p_montant numeric, p_user_id integer, p_notes text) OWNER TO postgres;

--
-- Name: update_client_solde(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_client_solde() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE clients 
    SET solde_actuel = calculer_solde_client(NEW.client_id)
    WHERE id = NEW.client_id;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE clients 
    SET solde_actuel = calculer_solde_client(NEW.client_id)
    WHERE id = NEW.client_id;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION public.update_client_solde() OWNER TO postgres;

--
-- Name: update_facture_fournisseur_payment_status(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_facture_fournisseur_payment_status() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.update_facture_fournisseur_payment_status() OWNER TO postgres;

--
-- Name: update_facture_ht_ttc(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_facture_ht_ttc() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.total_ht  := NEW.sous_total;
  NEW.total_ttc := NEW.total;
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_facture_ht_ttc() OWNER TO postgres;

--
-- Name: update_facture_on_payment_delete(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_facture_on_payment_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      DECLARE
        total_due NUMERIC(10, 2);
        total_paid NUMERIC(10, 2);
      BEGIN
        -- Get invoice total
        SELECT total INTO total_due FROM factures WHERE id = OLD.facture_id;
        
        -- Calculate total payments (excluding deleted one)
        SELECT COALESCE(SUM(montant), 0) INTO total_paid 
        FROM paiements 
        WHERE facture_id = OLD.facture_id;
        
        -- Update invoice status, montant_paye and remaining_due
        UPDATE factures 
        SET 
          montant_paye = total_paid,
          remaining_due = total_due - total_paid,
          statut = CASE
            WHEN total_paid = 0 THEN 'en_attente'
            WHEN total_paid < total_due THEN 'partielle'
            WHEN total_paid >= total_due THEN 'payee'
          END
        WHERE id = OLD.facture_id;
        
        RETURN OLD;
      END;
      $$;


ALTER FUNCTION public.update_facture_on_payment_delete() OWNER TO postgres;

--
-- Name: update_facture_payment_status(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_facture_payment_status() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.update_facture_payment_status() OWNER TO postgres;

--
-- Name: update_produits_stock_from_locations(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_produits_stock_from_locations() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  total_stock INTEGER;
BEGIN
  -- Calculate total stock across all active locations
  SELECT COALESCE(SUM(quantite), 0) INTO total_stock
  FROM stock_par_location spl
  JOIN stock_locations sl ON spl.location_id = sl.id
  WHERE spl.produit_id = COALESCE(NEW.produit_id, OLD.produit_id)
    AND sl.actif = true;
  
  -- Update the cache column
  UPDATE produits 
  SET stock = total_stock
  WHERE id = COALESCE(NEW.produit_id, OLD.produit_id);
  
  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION public.update_produits_stock_from_locations() OWNER TO postgres;

--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_updated_at_column() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _deprecated_internal_stock_request_lignes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public._deprecated_internal_stock_request_lignes (
    id integer CONSTRAINT internal_stock_request_lignes_id_not_null NOT NULL,
    request_id integer CONSTRAINT internal_stock_request_lignes_request_id_not_null NOT NULL,
    produit_id integer CONSTRAINT internal_stock_request_lignes_produit_id_not_null NOT NULL,
    quantite_demandee integer CONSTRAINT internal_stock_request_lignes_quantite_demandee_not_null NOT NULL,
    quantite_validee integer,
    quantite_transferee integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT internal_stock_request_lignes_quantite_demandee_check CHECK ((quantite_demandee > 0))
);


ALTER TABLE public._deprecated_internal_stock_request_lignes OWNER TO postgres;

--
-- Name: _deprecated_internal_stock_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public._deprecated_internal_stock_requests (
    id integer CONSTRAINT internal_stock_requests_id_not_null NOT NULL,
    numero_demande character varying(50) CONSTRAINT internal_stock_requests_numero_demande_not_null NOT NULL,
    magasin_id integer CONSTRAINT internal_stock_requests_magasin_id_not_null NOT NULL,
    depot_id integer CONSTRAINT internal_stock_requests_depot_id_not_null NOT NULL,
    statut character varying(20) DEFAULT 'en_attente'::character varying CONSTRAINT internal_stock_requests_statut_not_null NOT NULL,
    notes text,
    motif_refus text,
    transfer_id integer,
    cree_par integer,
    valide_par integer,
    execute_par integer,
    date_validation timestamp without time zone,
    date_execution timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT internal_stock_requests_check CHECK ((magasin_id <> depot_id)),
    CONSTRAINT internal_stock_requests_statut_check CHECK (((statut)::text = ANY ((ARRAY['en_attente'::character varying, 'validee'::character varying, 'refusee'::character varying, 'executee'::character varying, 'annulee'::character varying])::text[])))
);


ALTER TABLE public._deprecated_internal_stock_requests OWNER TO postgres;

--
-- Name: TABLE _deprecated_internal_stock_requests; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public._deprecated_internal_stock_requests IS 'Internal stock requests from magasin to depot';


--
-- Name: COLUMN _deprecated_internal_stock_requests.statut; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public._deprecated_internal_stock_requests.statut IS 'en_attente=pending validation, validee=approved by depot, refusee=rejected, executee=transfer completed, annulee=cancelled';


--
-- Name: _deprecated_three_way_match_details_2026_05; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public._deprecated_three_way_match_details_2026_05 (
    id integer CONSTRAINT three_way_match_details_id_not_null NOT NULL,
    match_id integer CONSTRAINT three_way_match_details_match_id_not_null NOT NULL,
    produit_id integer CONSTRAINT three_way_match_details_produit_id_not_null NOT NULL,
    quantite_commandee integer CONSTRAINT three_way_match_details_quantite_commandee_not_null NOT NULL,
    quantite_recue integer CONSTRAINT three_way_match_details_quantite_recue_not_null NOT NULL,
    prix_commande numeric(15,2) CONSTRAINT three_way_match_details_prix_commande_not_null NOT NULL,
    prix_facture numeric(15,2) CONSTRAINT three_way_match_details_prix_facture_not_null NOT NULL,
    ecart_quantite integer DEFAULT 0,
    ecart_prix numeric(15,2) DEFAULT 0.00,
    commentaire text
);


ALTER TABLE public._deprecated_three_way_match_details_2026_05 OWNER TO postgres;

--
-- Name: TABLE _deprecated_three_way_match_details_2026_05; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public._deprecated_three_way_match_details_2026_05 IS 'Table archivée - Détails 3-Way Match supprimé le 2026-05-06. Contient les écarts quantité/prix par produit.';


--
-- Name: _deprecated_three_way_matches_2026_05; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public._deprecated_three_way_matches_2026_05 (
    id integer CONSTRAINT three_way_matches_id_not_null NOT NULL,
    commande_id integer CONSTRAINT three_way_matches_commande_id_not_null NOT NULL,
    reception_id integer CONSTRAINT three_way_matches_reception_id_not_null NOT NULL,
    facture_fournisseur_id integer,
    date_verification timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    statut character varying(20) DEFAULT 'en_attente'::character varying,
    ecart_quantite integer DEFAULT 0,
    ecart_prix numeric(15,2) DEFAULT 0.00,
    notes text,
    valide_par integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT three_way_matches_statut_check CHECK (((statut)::text = ANY ((ARRAY['en_attente'::character varying, 'valide'::character varying, 'ecart_identifie'::character varying, 'rejete'::character varying])::text[])))
);


ALTER TABLE public._deprecated_three_way_matches_2026_05 OWNER TO postgres;

--
-- Name: TABLE _deprecated_three_way_matches_2026_05; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public._deprecated_three_way_matches_2026_05 IS 'Table archivée - 3-Way Match supprimé le 2026-05-06. Contient les enregistrements de matching commande/réception/facture.';


--
-- Name: acompte_applications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.acompte_applications (
    id integer NOT NULL,
    acompte_id integer NOT NULL,
    facture_id integer NOT NULL,
    paiement_id integer,
    montant numeric(15,2) NOT NULL,
    date_application timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    cree_par integer,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT acompte_applications_montant_check CHECK ((montant > (0)::numeric))
);


ALTER TABLE public.acompte_applications OWNER TO postgres;

--
-- Name: acompte_applications_fournisseur; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.acompte_applications_fournisseur (
    id integer NOT NULL,
    acompte_id integer NOT NULL,
    facture_id integer NOT NULL,
    paiement_id integer,
    montant numeric(15,2) NOT NULL,
    date_application timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    cree_par integer,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT acompte_applications_fournisseur_montant_check CHECK ((montant > (0)::numeric))
);


ALTER TABLE public.acompte_applications_fournisseur OWNER TO postgres;

--
-- Name: acompte_applications_fournisseur_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.acompte_applications_fournisseur_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.acompte_applications_fournisseur_id_seq OWNER TO postgres;

--
-- Name: acompte_applications_fournisseur_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.acompte_applications_fournisseur_id_seq OWNED BY public.acompte_applications_fournisseur.id;


--
-- Name: acompte_applications_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.acompte_applications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.acompte_applications_id_seq OWNER TO postgres;

--
-- Name: acompte_applications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.acompte_applications_id_seq OWNED BY public.acompte_applications.id;


--
-- Name: acomptes_clients; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.acomptes_clients (
    id integer NOT NULL,
    tiers_id integer NOT NULL,
    montant numeric(15,2) NOT NULL,
    methode_paiement character varying(50),
    date_acompte timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    statut character varying(20) DEFAULT 'disponible'::character varying,
    facture_id_applique integer,
    date_utilisation timestamp without time zone,
    notes text,
    cree_par integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    magasin_id integer,
    session_caisse_id integer,
    mouvement_caisse_id integer,
    montant_restant numeric(15,2) NOT NULL,
    idempotency_key character varying(80),
    reference_number character varying(100),
    rembourse_par_user_id integer,
    date_remboursement timestamp without time zone,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp without time zone,
    CONSTRAINT acomptes_clients_methode_paiement_check CHECK (((methode_paiement)::text = ANY ((ARRAY['espece'::character varying, 'carte'::character varying, 'cheque'::character varying, 'virement'::character varying, 'mobile_money'::character varying, 'orange_money'::character varying, 'mtn_money'::character varying, 'wave'::character varying, 'compensation'::character varying])::text[]))),
    CONSTRAINT acomptes_clients_statut_check CHECK (((statut)::text = ANY ((ARRAY['disponible'::character varying, 'partiellement_utilise'::character varying, 'utilise'::character varying, 'rembourse'::character varying])::text[])))
);


ALTER TABLE public.acomptes_clients OWNER TO postgres;

--
-- Name: TABLE acomptes_clients; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.acomptes_clients IS 'Advance payments received from client-role tiers';


--
-- Name: COLUMN acomptes_clients.magasin_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.acomptes_clients.magasin_id IS 'Store where this advance was received - required for cash transactions';


--
-- Name: acomptes_clients_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.acomptes_clients_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.acomptes_clients_id_seq OWNER TO postgres;

--
-- Name: acomptes_clients_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.acomptes_clients_id_seq OWNED BY public.acomptes_clients.id;


--
-- Name: acomptes_fournisseur; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.acomptes_fournisseur (
    id integer NOT NULL,
    tiers_id integer NOT NULL,
    montant numeric(15,2) NOT NULL,
    methode_paiement character varying(50),
    date_acompte timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    statut character varying(20) DEFAULT 'disponible'::character varying,
    facture_id_applique integer,
    date_utilisation timestamp without time zone,
    notes text,
    cree_par integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    magasin_id integer,
    session_caisse_id integer,
    mouvement_caisse_id integer,
    montant_restant numeric(15,2) NOT NULL,
    idempotency_key character varying(80),
    reference_number character varying(100),
    rembourse_par_user_id integer,
    date_remboursement timestamp without time zone,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp without time zone,
    CONSTRAINT acomptes_fournisseur_methode_paiement_check CHECK (((methode_paiement)::text = ANY ((ARRAY['espece'::character varying, 'carte'::character varying, 'cheque'::character varying, 'virement'::character varying, 'mobile_money'::character varying, 'orange_money'::character varying, 'mtn_money'::character varying, 'wave'::character varying, 'compensation'::character varying])::text[]))),
    CONSTRAINT acomptes_fournisseur_statut_check CHECK (((statut)::text = ANY ((ARRAY['disponible'::character varying, 'partiellement_utilise'::character varying, 'utilise'::character varying, 'rembourse'::character varying])::text[])))
);


ALTER TABLE public.acomptes_fournisseur OWNER TO postgres;

--
-- Name: TABLE acomptes_fournisseur; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.acomptes_fournisseur IS 'Advance payments made to supplier-role tiers';


--
-- Name: COLUMN acomptes_fournisseur.session_caisse_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.acomptes_fournisseur.session_caisse_id IS 'Session caisse open at time of cash acompte creation.';


--
-- Name: COLUMN acomptes_fournisseur.mouvement_caisse_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.acomptes_fournisseur.mouvement_caisse_id IS 'Link to mouvements_caisse row created when acompte paid in cash. NULL for non-cash methods.';


--
-- Name: acomptes_fournisseur_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.acomptes_fournisseur_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.acomptes_fournisseur_id_seq OWNER TO postgres;

--
-- Name: acomptes_fournisseur_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.acomptes_fournisseur_id_seq OWNED BY public.acomptes_fournisseur.id;


--
-- Name: allocation_audit; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.allocation_audit (
    id integer NOT NULL,
    tiers_id integer NOT NULL,
    allocation_type character varying(50) NOT NULL,
    before_data jsonb,
    after_data jsonb,
    created_by integer,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.allocation_audit OWNER TO postgres;

--
-- Name: allocation_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.allocation_audit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.allocation_audit_id_seq OWNER TO postgres;

--
-- Name: allocation_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.allocation_audit_id_seq OWNED BY public.allocation_audit.id;


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.audit_log (
    id integer NOT NULL,
    utilisateur_id integer,
    action character varying(50) NOT NULL,
    table_name character varying(100) NOT NULL,
    record_id integer,
    old_values jsonb,
    new_values jsonb,
    ip_address character varying(45),
    user_agent text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT audit_log_action_check CHECK (((action)::text = ANY ((ARRAY['create'::character varying, 'update'::character varying, 'delete'::character varying, 'login'::character varying, 'logout'::character varying])::text[])))
);


ALTER TABLE public.audit_log OWNER TO postgres;

--
-- Name: TABLE audit_log; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.audit_log IS 'Append-only audit log - DO NOT UPDATE OR DELETE';


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.audit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.audit_log_id_seq OWNER TO postgres;

--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;


--
-- Name: avoir_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.avoir_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.avoir_seq OWNER TO postgres;

--
-- Name: barcode_scans; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.barcode_scans (
    id integer NOT NULL,
    code_barre character varying(100) NOT NULL,
    produit_id integer,
    utilisateur_id integer,
    date_scan timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    succes boolean DEFAULT true
);


ALTER TABLE public.barcode_scans OWNER TO postgres;

--
-- Name: TABLE barcode_scans; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.barcode_scans IS 'Barcode scan history for analytics';


--
-- Name: barcode_scans_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.barcode_scans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.barcode_scans_id_seq OWNER TO postgres;

--
-- Name: barcode_scans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.barcode_scans_id_seq OWNED BY public.barcode_scans.id;


--
-- Name: bl_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.bl_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.bl_seq OWNER TO postgres;

--
-- Name: bon_livraison_lignes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.bon_livraison_lignes (
    id integer NOT NULL,
    bl_id integer NOT NULL,
    produit_id integer,
    description character varying(255),
    quantite_commandee integer DEFAULT 1 NOT NULL,
    quantite_livree integer DEFAULT 1 NOT NULL,
    prix_unitaire numeric(15,2) NOT NULL,
    total_ligne numeric(15,2) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT bon_livraison_lignes_quantite_commandee_check CHECK ((quantite_commandee > 0)),
    CONSTRAINT bon_livraison_lignes_quantite_livree_check CHECK ((quantite_livree >= 0))
);


ALTER TABLE public.bon_livraison_lignes OWNER TO postgres;

--
-- Name: bon_livraison_lignes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.bon_livraison_lignes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.bon_livraison_lignes_id_seq OWNER TO postgres;

--
-- Name: bon_livraison_lignes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.bon_livraison_lignes_id_seq OWNED BY public.bon_livraison_lignes.id;


--
-- Name: bons_livraison; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.bons_livraison (
    id integer NOT NULL,
    numero_bl character varying(50) NOT NULL,
    tiers_id integer NOT NULL,
    devis_id integer,
    date_bl date DEFAULT CURRENT_DATE NOT NULL,
    statut character varying(20) DEFAULT 'brouillon'::character varying,
    facture_id integer,
    sous_total numeric(15,2) DEFAULT 0.00 NOT NULL,
    tva numeric(15,2) DEFAULT 0.00 NOT NULL,
    total numeric(15,2) DEFAULT 0.00 NOT NULL,
    notes text,
    adresse_livraison text,
    date_livraison_prevue date,
    location_id integer,
    cree_par integer,
    deleted_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT bons_livraison_statut_check CHECK (((statut)::text = ANY ((ARRAY['brouillon'::character varying, 'valide'::character varying, 'livre'::character varying, 'facture'::character varying, 'annule'::character varying])::text[])))
);


ALTER TABLE public.bons_livraison OWNER TO postgres;

--
-- Name: bons_livraison_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.bons_livraison_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.bons_livraison_id_seq OWNER TO postgres;

--
-- Name: bons_livraison_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.bons_livraison_id_seq OWNED BY public.bons_livraison.id;


--
-- Name: caisses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.caisses (
    id integer NOT NULL,
    code character varying(20) NOT NULL,
    nom character varying(100) NOT NULL,
    type character varying(20) NOT NULL,
    location_id integer,
    caisse_parent_id integer,
    solde_actuel numeric(15,2) DEFAULT 0.00,
    actif boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT caisses_type_check CHECK (((type)::text = ANY ((ARRAY['principale'::character varying, 'magasin'::character varying])::text[])))
);


ALTER TABLE public.caisses OWNER TO postgres;

--
-- Name: TABLE caisses; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.caisses IS 'Cash register hierarchy - principale and magasin caisses';


--
-- Name: caisses_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.caisses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.caisses_id_seq OWNER TO postgres;

--
-- Name: caisses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.caisses_id_seq OWNED BY public.caisses.id;


--
-- Name: categories_depenses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.categories_depenses (
    id integer NOT NULL,
    code character varying(20) NOT NULL,
    nom character varying(100) NOT NULL,
    description text,
    compte_comptable_id integer,
    actif boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.categories_depenses OWNER TO postgres;

--
-- Name: categories_depenses_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.categories_depenses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.categories_depenses_id_seq OWNER TO postgres;

--
-- Name: categories_depenses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.categories_depenses_id_seq OWNED BY public.categories_depenses.id;


--
-- Name: commande_lignes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.commande_lignes (
    id integer NOT NULL,
    commande_id integer NOT NULL,
    produit_id integer NOT NULL,
    quantite integer DEFAULT 1 NOT NULL,
    prix_unitaire numeric(15,2) NOT NULL,
    total_ligne numeric(15,2) NOT NULL
);


ALTER TABLE public.commande_lignes OWNER TO postgres;

--
-- Name: commande_lignes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.commande_lignes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.commande_lignes_id_seq OWNER TO postgres;

--
-- Name: commande_lignes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.commande_lignes_id_seq OWNED BY public.commande_lignes.id;


--
-- Name: commande_numero_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.commande_numero_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.commande_numero_seq OWNER TO postgres;

--
-- Name: commandes_fournisseur; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.commandes_fournisseur (
    id integer NOT NULL,
    tiers_id integer NOT NULL,
    numero_commande character varying(50) NOT NULL,
    date_commande timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    date_livraison_prevue date,
    date_livraison_reelle date,
    statut character varying(20) DEFAULT 'en_attente'::character varying,
    sous_total numeric(15,2) DEFAULT 0.00,
    notes text,
    deleted_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT commandes_fournisseur_statut_check CHECK (((statut)::text = ANY ((ARRAY['en_attente'::character varying, 'validee'::character varying, 'expediee'::character varying, 'livree'::character varying, 'annulee'::character varying])::text[])))
);


ALTER TABLE public.commandes_fournisseur OWNER TO postgres;

--
-- Name: commandes_fournisseur_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.commandes_fournisseur_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.commandes_fournisseur_id_seq OWNER TO postgres;

--
-- Name: commandes_fournisseur_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.commandes_fournisseur_id_seq OWNED BY public.commandes_fournisseur.id;


--
-- Name: compensations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.compensations (
    id integer NOT NULL,
    tiers_id integer NOT NULL,
    date_compensation date DEFAULT CURRENT_DATE NOT NULL,
    montant numeric(15,2) NOT NULL,
    factures_client_ids integer[] DEFAULT '{}'::integer[] NOT NULL,
    factures_fournisseur_ids integer[] DEFAULT '{}'::integer[] NOT NULL,
    ecriture_id integer,
    notes text,
    statut character varying(20) DEFAULT 'valide'::character varying,
    cree_par integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT compensations_montant_check CHECK ((montant > (0)::numeric)),
    CONSTRAINT compensations_statut_check CHECK (((statut)::text = ANY ((ARRAY['valide'::character varying, 'annule'::character varying])::text[])))
);


ALTER TABLE public.compensations OWNER TO postgres;

--
-- Name: TABLE compensations; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.compensations IS 'Netting operations: extinguishes min(créance_client, dette_fourn) with OD journal entry 401↔411';


--
-- Name: compensations_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.compensations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.compensations_id_seq OWNER TO postgres;

--
-- Name: compensations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.compensations_id_seq OWNED BY public.compensations.id;


--
-- Name: compte_client_lignes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.compte_client_lignes (
    id integer NOT NULL,
    tiers_id integer NOT NULL,
    date_operation timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    type_operation character varying(50) NOT NULL,
    document_id integer,
    document_numero character varying(100),
    montant_debit numeric(15,2) DEFAULT 0.00,
    montant_credit numeric(15,2) DEFAULT 0.00,
    solde_avant numeric(15,2) DEFAULT 0.00,
    solde_apres numeric(15,2) DEFAULT 0.00,
    notes text,
    cree_par integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT compte_client_lignes_type_operation_check CHECK (((type_operation)::text = ANY ((ARRAY['facture'::character varying, 'paiement'::character varying, 'acompte'::character varying, 'avoir'::character varying, 'remise'::character varying, 'ajustement'::character varying, 'compensation'::character varying])::text[])))
);


ALTER TABLE public.compte_client_lignes OWNER TO postgres;

--
-- Name: TABLE compte_client_lignes; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.compte_client_lignes IS 'Client-side ledger. debit=tiers owes us, credit=tiers paid/credited';


--
-- Name: compte_client_lignes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.compte_client_lignes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.compte_client_lignes_id_seq OWNER TO postgres;

--
-- Name: compte_client_lignes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.compte_client_lignes_id_seq OWNED BY public.compte_client_lignes.id;


--
-- Name: compte_fournisseur_lignes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.compte_fournisseur_lignes (
    id integer NOT NULL,
    tiers_id integer NOT NULL,
    type_operation character varying(30) NOT NULL,
    document_id integer,
    document_numero character varying(100),
    montant_debit numeric(15,2) DEFAULT 0.00 NOT NULL,
    montant_credit numeric(15,2) DEFAULT 0.00 NOT NULL,
    notes text,
    cree_par integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT compte_fournisseur_lignes_type_operation_check CHECK (((type_operation)::text = ANY ((ARRAY['facture'::character varying, 'paiement'::character varying, 'avoir'::character varying, 'ajustement'::character varying, 'compensation'::character varying, 'acompte'::character varying])::text[])))
);


ALTER TABLE public.compte_fournisseur_lignes OWNER TO postgres;

--
-- Name: TABLE compte_fournisseur_lignes; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.compte_fournisseur_lignes IS 'Supplier-side ledger. debit=we paid (reduces AP), credit=new invoice received (increases AP)';


--
-- Name: compte_fournisseur_lignes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.compte_fournisseur_lignes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.compte_fournisseur_lignes_id_seq OWNER TO postgres;

--
-- Name: compte_fournisseur_lignes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.compte_fournisseur_lignes_id_seq OWNED BY public.compte_fournisseur_lignes.id;


--
-- Name: demande_reappro_numero_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.demande_reappro_numero_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.demande_reappro_numero_seq OWNER TO postgres;

--
-- Name: demandes_reapprovisionnement; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.demandes_reapprovisionnement (
    id integer NOT NULL,
    numero character varying(50) NOT NULL,
    magasin_id integer NOT NULL,
    depot_id integer NOT NULL,
    statut character varying(30) DEFAULT 'brouillon'::character varying NOT NULL,
    created_by_user_id integer,
    decided_by_user_id integer,
    executed_by_user_id integer,
    closed_by_user_id integer,
    date_creation timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    date_envoi timestamp without time zone,
    date_decision timestamp without time zone,
    date_execution timestamp without time zone,
    date_livraison timestamp without time zone,
    date_cloture timestamp without time zone,
    motif text,
    raison_refus text,
    transfert_id integer,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT demandes_reapprovisionnement_check CHECK ((magasin_id <> depot_id)),
    CONSTRAINT demandes_reapprovisionnement_statut_check CHECK (((statut)::text = ANY ((ARRAY['brouillon'::character varying, 'envoyee'::character varying, 'approuvee'::character varying, 'partiellement_approuvee'::character varying, 'refusee'::character varying, 'en_cours'::character varying, 'livree'::character varying, 'cloturee'::character varying])::text[])))
);


ALTER TABLE public.demandes_reapprovisionnement OWNER TO postgres;

--
-- Name: TABLE demandes_reapprovisionnement; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.demandes_reapprovisionnement IS 'Stock replenishment requests from magasin to depot with full state machine';


--
-- Name: COLUMN demandes_reapprovisionnement.statut; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.demandes_reapprovisionnement.statut IS 'State machine: brouillon→envoyee→[approuvee|partiellement_approuvee|refusee]→en_cours→livree→cloturee';


--
-- Name: demandes_reapprovisionnement_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.demandes_reapprovisionnement_history (
    id integer NOT NULL,
    demande_id integer NOT NULL,
    from_statut character varying(30),
    to_statut character varying(30) NOT NULL,
    user_id integer,
    "timestamp" timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    payload jsonb,
    ip_address character varying(45),
    user_agent text
);


ALTER TABLE public.demandes_reapprovisionnement_history OWNER TO postgres;

--
-- Name: TABLE demandes_reapprovisionnement_history; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.demandes_reapprovisionnement_history IS 'Append-only audit log of all state transitions on demandes';


--
-- Name: demandes_reapprovisionnement_history_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.demandes_reapprovisionnement_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.demandes_reapprovisionnement_history_id_seq OWNER TO postgres;

--
-- Name: demandes_reapprovisionnement_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.demandes_reapprovisionnement_history_id_seq OWNED BY public.demandes_reapprovisionnement_history.id;


--
-- Name: demandes_reapprovisionnement_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.demandes_reapprovisionnement_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.demandes_reapprovisionnement_id_seq OWNER TO postgres;

--
-- Name: demandes_reapprovisionnement_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.demandes_reapprovisionnement_id_seq OWNED BY public.demandes_reapprovisionnement.id;


--
-- Name: demandes_reapprovisionnement_lignes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.demandes_reapprovisionnement_lignes (
    id integer NOT NULL,
    demande_id integer NOT NULL,
    produit_id integer NOT NULL,
    quantite_demandee integer NOT NULL,
    quantite_approuvee integer,
    quantite_livree integer,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT demandes_reapprovisionnement_lignes_quantite_demandee_check CHECK ((quantite_demandee > 0))
);


ALTER TABLE public.demandes_reapprovisionnement_lignes OWNER TO postgres;

--
-- Name: TABLE demandes_reapprovisionnement_lignes; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.demandes_reapprovisionnement_lignes IS 'Line items for replenishment requests with requested/approved/delivered quantities';


--
-- Name: demandes_reapprovisionnement_lignes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.demandes_reapprovisionnement_lignes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.demandes_reapprovisionnement_lignes_id_seq OWNER TO postgres;

--
-- Name: demandes_reapprovisionnement_lignes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.demandes_reapprovisionnement_lignes_id_seq OWNED BY public.demandes_reapprovisionnement_lignes.id;


--
-- Name: depense_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.depense_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.depense_seq OWNER TO postgres;

--
-- Name: depenses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.depenses (
    id integer NOT NULL,
    numero_depense character varying(50) NOT NULL,
    location_id integer,
    session_caisse_id integer,
    categorie_id integer NOT NULL,
    tiers_id integer,
    montant numeric(15,2) NOT NULL,
    methode_paiement character varying(50),
    date_depense date DEFAULT CURRENT_DATE NOT NULL,
    description text NOT NULL,
    justificatif_url character varying(500),
    cree_par integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    magasin_id integer,
    mouvement_caisse_id integer,
    beneficiaire_libre character varying(255),
    deleted_at timestamp without time zone,
    CONSTRAINT depenses_methode_paiement_check CHECK (((methode_paiement)::text = ANY ((ARRAY['espece'::character varying, 'carte'::character varying, 'cheque'::character varying, 'virement'::character varying])::text[]))),
    CONSTRAINT depenses_montant_check CHECK ((montant > (0)::numeric))
);


ALTER TABLE public.depenses OWNER TO postgres;

--
-- Name: TABLE depenses; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.depenses IS 'Store/warehouse expenses tracking';


--
-- Name: COLUMN depenses.location_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.depenses.location_id IS 'Location where expense occurred';


--
-- Name: COLUMN depenses.session_caisse_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.depenses.session_caisse_id IS 'Linked cash session if paid from caisse';


--
-- Name: COLUMN depenses.magasin_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.depenses.magasin_id IS 'Store where this expense occurred - required, replaces location_id for cash operations';


--
-- Name: COLUMN depenses.mouvement_caisse_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.depenses.mouvement_caisse_id IS 'Link to cash movement - auto-filled for cash payments';


--
-- Name: COLUMN depenses.beneficiaire_libre; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.depenses.beneficiaire_libre IS 'Free-text beneficiary when no supplier linked';


--
-- Name: COLUMN depenses.deleted_at; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.depenses.deleted_at IS 'Soft delete marker. NULL = active. Filtered out in DepenseServiceV2.getAll.';


--
-- Name: depenses_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.depenses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.depenses_id_seq OWNER TO postgres;

--
-- Name: depenses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.depenses_id_seq OWNED BY public.depenses.id;


--
-- Name: devis; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.devis (
    id integer NOT NULL,
    numero_devis character varying(50) NOT NULL,
    tiers_id integer NOT NULL,
    date_devis date DEFAULT CURRENT_DATE NOT NULL,
    date_validite date,
    statut character varying(20) DEFAULT 'brouillon'::character varying,
    sous_total numeric(15,2) DEFAULT 0.00 NOT NULL,
    remise_globale numeric(15,2) DEFAULT 0.00,
    remise_globale_pct numeric(5,2) DEFAULT 0.00,
    tva numeric(15,2) DEFAULT 0.00 NOT NULL,
    total numeric(15,2) DEFAULT 0.00 NOT NULL,
    total_ht numeric(15,2),
    total_ttc numeric(15,2),
    notes text,
    conditions text,
    location_id integer,
    facture_id integer,
    cree_par integer,
    deleted_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT devis_statut_check CHECK (((statut)::text = ANY ((ARRAY['brouillon'::character varying, 'envoye'::character varying, 'accepte'::character varying, 'refuse'::character varying, 'annule'::character varying, 'converti'::character varying])::text[])))
);


ALTER TABLE public.devis OWNER TO postgres;

--
-- Name: devis_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.devis_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.devis_id_seq OWNER TO postgres;

--
-- Name: devis_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.devis_id_seq OWNED BY public.devis.id;


--
-- Name: devis_lignes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.devis_lignes (
    id integer NOT NULL,
    devis_id integer NOT NULL,
    produit_id integer,
    description character varying(255),
    quantite integer DEFAULT 1 NOT NULL,
    prix_unitaire numeric(15,2) NOT NULL,
    remise_pct numeric(5,2) DEFAULT 0.00,
    remise_montant numeric(15,2) DEFAULT 0.00,
    total_ligne numeric(15,2) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT devis_lignes_quantite_check CHECK ((quantite > 0))
);


ALTER TABLE public.devis_lignes OWNER TO postgres;

--
-- Name: devis_lignes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.devis_lignes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.devis_lignes_id_seq OWNER TO postgres;

--
-- Name: devis_lignes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.devis_lignes_id_seq OWNED BY public.devis_lignes.id;


--
-- Name: devis_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.devis_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.devis_seq OWNER TO postgres;

--
-- Name: document_lignes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.document_lignes (
    id integer NOT NULL,
    document_type character varying(20) NOT NULL,
    document_id integer NOT NULL,
    produit_id integer,
    description character varying(255),
    quantite integer DEFAULT 1 NOT NULL,
    quantite_livree integer,
    prix_unitaire numeric(15,2) NOT NULL,
    remise_pct numeric(5,2) DEFAULT 0,
    remise_montant numeric(15,2) DEFAULT 0,
    total_ligne numeric(15,2) NOT NULL,
    parent_ligne_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT document_lignes_document_type_check CHECK (((document_type)::text = ANY ((ARRAY['facture'::character varying, 'devis'::character varying, 'bl'::character varying, 'avoir'::character varying])::text[]))),
    CONSTRAINT document_lignes_quantite_check CHECK ((quantite > 0))
);


ALTER TABLE public.document_lignes OWNER TO postgres;

--
-- Name: document_lignes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.document_lignes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.document_lignes_id_seq OWNER TO postgres;

--
-- Name: document_lignes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.document_lignes_id_seq OWNED BY public.document_lignes.id;


--
-- Name: ecritures_comptables; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ecritures_comptables (
    id integer NOT NULL,
    numero_piece character varying(50),
    date_ecriture timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    journal character varying(20) NOT NULL,
    piece_id integer,
    piece_type character varying(50),
    ligne_numero integer NOT NULL,
    compte_id integer NOT NULL,
    debit numeric(15,2) DEFAULT 0.00 NOT NULL,
    credit numeric(15,2) DEFAULT 0.00 NOT NULL,
    description text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ecritures_comptables_credit_check CHECK ((credit >= (0)::numeric)),
    CONSTRAINT ecritures_comptables_debit_check CHECK ((debit >= (0)::numeric)),
    CONSTRAINT ecritures_comptables_journal_check CHECK (((journal)::text = ANY ((ARRAY['ACHATS'::character varying, 'VENTES'::character varying, 'TRESORERIE'::character varying, 'OD'::character varying])::text[])))
);


ALTER TABLE public.ecritures_comptables OWNER TO postgres;

--
-- Name: ecritures_comptables_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.ecritures_comptables_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ecritures_comptables_id_seq OWNER TO postgres;

--
-- Name: ecritures_comptables_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.ecritures_comptables_id_seq OWNED BY public.ecritures_comptables.id;


--
-- Name: employes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.employes (
    id integer NOT NULL,
    utilisateur_id integer,
    matricule character varying(50) NOT NULL,
    nom_complet character varying(255) NOT NULL,
    poste character varying(100),
    departement character varying(100),
    date_embauche date NOT NULL,
    date_naissance date,
    telephone character varying(20),
    email character varying(255),
    adresse text,
    salaire_base numeric(15,2),
    commission_taux numeric(5,2) DEFAULT 0.00,
    actif boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.employes OWNER TO postgres;

--
-- Name: employes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.employes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.employes_id_seq OWNER TO postgres;

--
-- Name: employes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.employes_id_seq OWNED BY public.employes.id;


--
-- Name: facture_avoir_lignes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.facture_avoir_lignes (
    id integer NOT NULL,
    avoir_id integer NOT NULL,
    produit_id integer,
    description character varying(255),
    quantite integer DEFAULT 1 NOT NULL,
    prix_unitaire numeric(15,2) NOT NULL,
    taux_tva_id integer,
    total_ligne numeric(15,2) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.facture_avoir_lignes OWNER TO postgres;

--
-- Name: facture_avoir_lignes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.facture_avoir_lignes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.facture_avoir_lignes_id_seq OWNER TO postgres;

--
-- Name: facture_avoir_lignes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.facture_avoir_lignes_id_seq OWNED BY public.facture_avoir_lignes.id;


--
-- Name: facture_fournisseur_lignes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.facture_fournisseur_lignes (
    id integer NOT NULL,
    facture_id integer NOT NULL,
    produit_id integer,
    description character varying(255),
    quantite integer DEFAULT 1 NOT NULL,
    prix_unitaire numeric(15,2) NOT NULL,
    tva_taux numeric(5,2) DEFAULT 0.00,
    total_ligne numeric(15,2) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.facture_fournisseur_lignes OWNER TO postgres;

--
-- Name: facture_fournisseur_lignes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.facture_fournisseur_lignes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.facture_fournisseur_lignes_id_seq OWNER TO postgres;

--
-- Name: facture_fournisseur_lignes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.facture_fournisseur_lignes_id_seq OWNED BY public.facture_fournisseur_lignes.id;


--
-- Name: facture_fournisseur_numero_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.facture_fournisseur_numero_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.facture_fournisseur_numero_seq OWNER TO postgres;

--
-- Name: facture_numero_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.facture_numero_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.facture_numero_seq OWNER TO postgres;

--
-- Name: factures; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.factures (
    id integer NOT NULL,
    numero_facture character varying(50) NOT NULL,
    tiers_id integer NOT NULL,
    devis_id integer,
    bl_id integer,
    date_facture timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    date_echeance date,
    delai_paiement character varying(50),
    sous_total numeric(15,2) DEFAULT 0.00 NOT NULL,
    tva numeric(15,2) DEFAULT 0.00 NOT NULL,
    total numeric(15,2) DEFAULT 0.00 NOT NULL,
    total_ht numeric(15,2),
    total_ttc numeric(15,2),
    montant_paye numeric(15,2) DEFAULT 0.00 NOT NULL,
    remaining_due numeric(15,2) DEFAULT 0.00 NOT NULL,
    statut character varying(20) DEFAULT 'en_attente'::character varying,
    type_facture character varying(20) DEFAULT 'standard'::character varying,
    hors_taxe boolean DEFAULT false,
    exoneration_raison character varying(100),
    notes text,
    location_id integer,
    allocation_version integer DEFAULT 1,
    deleted_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    cree_par integer,
    modifie_par integer,
    remise_globale numeric(15,2) DEFAULT 0.00,
    remise_globale_pct numeric(5,2) DEFAULT 0.00,
    magasin_id integer,
    CONSTRAINT factures_statut_check CHECK (((statut)::text = ANY ((ARRAY['payee'::character varying, 'partielle'::character varying, 'en_attente'::character varying, 'annulee'::character varying])::text[]))),
    CONSTRAINT factures_tva_zero CHECK ((tva = (0)::numeric)),
    CONSTRAINT factures_type_facture_check CHECK (((type_facture)::text = ANY ((ARRAY['standard'::character varying, 'avoir'::character varying, 'echange'::character varying])::text[])))
);


ALTER TABLE public.factures OWNER TO postgres;

--
-- Name: factures_avoir; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.factures_avoir (
    id integer NOT NULL,
    numero_avoir character varying(50) NOT NULL,
    tiers_id integer NOT NULL,
    facture_origine_id integer,
    retour_id integer,
    date_avoir date DEFAULT CURRENT_DATE NOT NULL,
    sous_total numeric(15,2) DEFAULT 0.00 NOT NULL,
    tva numeric(15,2) DEFAULT 0.00 NOT NULL,
    total numeric(15,2) DEFAULT 0.00 NOT NULL,
    total_ht numeric(15,2),
    total_ttc numeric(15,2),
    statut character varying(20) DEFAULT 'brouillon'::character varying,
    avoir_type character varying(20) DEFAULT 'retour'::character varying,
    notes text,
    location_id integer,
    cree_par integer,
    deleted_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    facture_appliquee_id integer,
    CONSTRAINT factures_avoir_avoir_type_check CHECK (((avoir_type)::text = ANY ((ARRAY['retour'::character varying, 'echange'::character varying, 'remise_commerciale'::character varying, 'erreur'::character varying])::text[]))),
    CONSTRAINT factures_avoir_statut_check CHECK (((statut)::text = ANY ((ARRAY['brouillon'::character varying, 'valide'::character varying, 'annule'::character varying, 'utilise'::character varying])::text[])))
);


ALTER TABLE public.factures_avoir OWNER TO postgres;

--
-- Name: factures_avoir_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.factures_avoir_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.factures_avoir_id_seq OWNER TO postgres;

--
-- Name: factures_avoir_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.factures_avoir_id_seq OWNED BY public.factures_avoir.id;


--
-- Name: factures_fournisseur; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.factures_fournisseur (
    id integer NOT NULL,
    tiers_id integer NOT NULL,
    reception_id integer,
    numero_facture_fournisseur character varying(100) NOT NULL,
    numero_facture_interne character varying(50) NOT NULL,
    date_facture date NOT NULL,
    date_echeance date,
    sous_total numeric(15,2) DEFAULT 0.00 NOT NULL,
    tva numeric(15,2) DEFAULT 0.00 NOT NULL,
    total numeric(15,2) DEFAULT 0.00 NOT NULL,
    montant_paye numeric(15,2) DEFAULT 0.00 NOT NULL,
    reste_due numeric(15,2) DEFAULT 0.00 NOT NULL,
    statut character varying(20) DEFAULT 'en_attente'::character varying,
    condition_paiement character varying(50),
    notes text,
    cree_par integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    commande_id integer,
    CONSTRAINT factures_fournisseur_statut_check CHECK (((statut)::text = ANY ((ARRAY['en_attente'::character varying, 'validee'::character varying, 'partiellement_payee'::character varying, 'payee'::character varying, 'annulee'::character varying])::text[])))
);


ALTER TABLE public.factures_fournisseur OWNER TO postgres;

--
-- Name: factures_fournisseur_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.factures_fournisseur_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.factures_fournisseur_id_seq OWNER TO postgres;

--
-- Name: factures_fournisseur_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.factures_fournisseur_id_seq OWNED BY public.factures_fournisseur.id;


--
-- Name: factures_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.factures_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.factures_id_seq OWNER TO postgres;

--
-- Name: factures_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.factures_id_seq OWNED BY public.factures.id;


--
-- Name: internal_request_numero_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.internal_request_numero_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.internal_request_numero_seq OWNER TO postgres;

--
-- Name: internal_stock_request_lignes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.internal_stock_request_lignes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.internal_stock_request_lignes_id_seq OWNER TO postgres;

--
-- Name: internal_stock_request_lignes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.internal_stock_request_lignes_id_seq OWNED BY public._deprecated_internal_stock_request_lignes.id;


--
-- Name: internal_stock_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.internal_stock_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.internal_stock_requests_id_seq OWNER TO postgres;

--
-- Name: internal_stock_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.internal_stock_requests_id_seq OWNED BY public._deprecated_internal_stock_requests.id;


--
-- Name: lots; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lots (
    id integer NOT NULL,
    produit_id integer NOT NULL,
    numero_lot character varying(100) NOT NULL,
    date_fabrication date,
    date_expiration date,
    quantite_initiale integer NOT NULL,
    quantite_restante integer NOT NULL,
    prix_achat_unitaire numeric(15,2),
    fournisseur_id integer,
    date_reception timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    statut character varying(20) DEFAULT 'actif'::character varying,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT lots_statut_check CHECK (((statut)::text = ANY ((ARRAY['actif'::character varying, 'epuise'::character varying, 'expire'::character varying, 'rappelle'::character varying])::text[])))
);


ALTER TABLE public.lots OWNER TO postgres;

--
-- Name: TABLE lots; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.lots IS 'Batch/lot tracking for perishable goods';


--
-- Name: COLUMN lots.numero_lot; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.lots.numero_lot IS 'Batch/lot number from supplier';


--
-- Name: COLUMN lots.date_expiration; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.lots.date_expiration IS 'Expiration date';


--
-- Name: COLUMN lots.quantite_initiale; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.lots.quantite_initiale IS 'Initial quantity received';


--
-- Name: COLUMN lots.quantite_restante; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.lots.quantite_restante IS 'Remaining quantity in stock';


--
-- Name: COLUMN lots.statut; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.lots.statut IS 'Status: actif, epuise, expire, rappelle';


--
-- Name: lots_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lots_id_seq OWNER TO postgres;

--
-- Name: lots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.lots_id_seq OWNED BY public.lots.id;


--
-- Name: magasins; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.magasins (
    id integer NOT NULL,
    location_id integer,
    code character varying(20) NOT NULL,
    nom character varying(100) NOT NULL,
    adresse text,
    telephone character varying(50),
    actif boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.magasins OWNER TO postgres;

--
-- Name: TABLE magasins; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.magasins IS 'Store locations for cash register management - separate from stock_locations for cash concerns';


--
-- Name: COLUMN magasins.location_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.magasins.location_id IS 'Link to stock_locations for stock management integration';


--
-- Name: magasins_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.magasins_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.magasins_id_seq OWNER TO postgres;

--
-- Name: magasins_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.magasins_id_seq OWNED BY public.magasins.id;


--
-- Name: mouvements_caisse; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mouvements_caisse (
    id integer NOT NULL,
    session_caisse_id integer CONSTRAINT mouvements_caisse_session_id_not_null NOT NULL,
    facture_id integer,
    montant numeric(15,2) NOT NULL,
    type_mouvement character varying(50),
    methode_paiement character varying(50) NOT NULL,
    description text,
    date_mouvement timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    cree_par integer,
    type character varying(20),
    categorie character varying(50),
    reference_type character varying(50),
    reference_id integer,
    libelle character varying(255),
    solde_apres numeric(15,2),
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    magasin_id integer,
    idempotency_key character varying(80),
    reversed_by_mouvement_id integer,
    reverses_mouvement_id integer,
    CONSTRAINT chk_mouvement_source CHECK ((((reference_type IS NOT NULL) AND (reference_id IS NOT NULL)) OR ((categorie)::text = ANY ((ARRAY['apport'::character varying, 'retrait_banque'::character varying, 'autre_entree'::character varying, 'autre_sortie'::character varying])::text[])))),
    CONSTRAINT mouvements_caisse_categorie_check CHECK (((categorie)::text = ANY ((ARRAY['paiement_client'::character varying, 'acompte_client'::character varying, 'apport'::character varying, 'autre_entree'::character varying, 'depense'::character varying, 'paiement_fournisseur'::character varying, 'retrait_banque'::character varying, 'remboursement_client'::character varying, 'autre_sortie'::character varying])::text[]))),
    CONSTRAINT mouvements_caisse_methode_paiement_check CHECK (((methode_paiement)::text = ANY ((ARRAY['espece'::character varying, 'carte'::character varying, 'cheque'::character varying, 'virement'::character varying, 'mobile_money'::character varying, 'orange_money'::character varying, 'mtn_money'::character varying, 'wave'::character varying])::text[]))),
    CONSTRAINT mouvements_caisse_reference_type_check CHECK (((reference_type)::text = ANY ((ARRAY['paiement'::character varying, 'acompte'::character varying, 'acompte_fournisseur'::character varying, 'depense'::character varying, 'paiement_fournisseur'::character varying, 'avoir'::character varying, 'apport'::character varying, 'retrait'::character varying])::text[]))),
    CONSTRAINT mouvements_caisse_type_check CHECK (((type)::text = ANY ((ARRAY['encaissement'::character varying, 'decaissement'::character varying])::text[]))),
    CONSTRAINT mouvements_caisse_type_mouvement_check CHECK (((type_mouvement)::text = ANY ((ARRAY['vente'::character varying, 'remise'::character varying, 'sortie'::character varying, 'entree_autre'::character varying])::text[])))
);


ALTER TABLE public.mouvements_caisse OWNER TO postgres;

--
-- Name: TABLE mouvements_caisse; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.mouvements_caisse IS 'Cash movements - APPEND ONLY: never UPDATE/DELETE, create reverse movement for cancellation';


--
-- Name: COLUMN mouvements_caisse.type; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.mouvements_caisse.type IS 'encaissement (in) or decaissement (out)';


--
-- Name: COLUMN mouvements_caisse.categorie; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.mouvements_caisse.categorie IS 'Business category of the movement';


--
-- Name: COLUMN mouvements_caisse.reference_type; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.mouvements_caisse.reference_type IS 'Polymorphic type: paiement, acompte, depense, paiement_fournisseur, avoir, apport, retrait';


--
-- Name: COLUMN mouvements_caisse.reference_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.mouvements_caisse.reference_id IS 'ID of the source record';


--
-- Name: COLUMN mouvements_caisse.libelle; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.mouvements_caisse.libelle IS 'Display label for the movement';


--
-- Name: COLUMN mouvements_caisse.solde_apres; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.mouvements_caisse.solde_apres IS 'Running balance after this movement (for real-time display)';


--
-- Name: mouvements_caisse_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.mouvements_caisse_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.mouvements_caisse_id_seq OWNER TO postgres;

--
-- Name: mouvements_caisse_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.mouvements_caisse_id_seq OWNED BY public.mouvements_caisse.id;


--
-- Name: mouvements_stock; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mouvements_stock (
    id integer NOT NULL,
    produit_id integer NOT NULL,
    type_mouvement character varying(20) NOT NULL,
    quantite integer NOT NULL,
    stock_avant integer NOT NULL,
    stock_apres integer NOT NULL,
    raison text,
    reference_liee character varying(50),
    date_mouvement timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    lot_id integer,
    numero_serie_id integer,
    location_id integer,
    transfer_id integer,
    CONSTRAINT mouvements_stock_type_mouvement_check CHECK (((type_mouvement)::text = ANY ((ARRAY['vente'::character varying, 'ajustement'::character varying, 'retour'::character varying, 'commande'::character varying, 'perte'::character varying, 'autre'::character varying, 'transfert'::character varying])::text[])))
);


ALTER TABLE public.mouvements_stock OWNER TO postgres;

--
-- Name: mouvements_stock_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.mouvements_stock_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.mouvements_stock_id_seq OWNER TO postgres;

--
-- Name: mouvements_stock_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.mouvements_stock_id_seq OWNED BY public.mouvements_stock.id;


--
-- Name: numeros_serie; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.numeros_serie (
    id integer NOT NULL,
    produit_id integer NOT NULL,
    numero_serie character varying(100) NOT NULL,
    lot_id integer,
    statut character varying(20) DEFAULT 'en_stock'::character varying,
    date_achat date,
    date_vente date,
    client_id integer,
    facture_id integer,
    prix_vente numeric(15,2),
    garantie_jusqu date,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT numeros_serie_statut_check CHECK (((statut)::text = ANY ((ARRAY['en_stock'::character varying, 'vendu'::character varying, 'retourne'::character varying, 'en_garantie'::character varying, 'reforme'::character varying])::text[])))
);


ALTER TABLE public.numeros_serie OWNER TO postgres;

--
-- Name: TABLE numeros_serie; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.numeros_serie IS 'Serial number tracking for high-value items';


--
-- Name: COLUMN numeros_serie.numero_serie; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.numeros_serie.numero_serie IS 'Unique serial number';


--
-- Name: COLUMN numeros_serie.statut; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.numeros_serie.statut IS 'Current status of the item';


--
-- Name: COLUMN numeros_serie.date_vente; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.numeros_serie.date_vente IS 'Sale date';


--
-- Name: COLUMN numeros_serie.garantie_jusqu; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.numeros_serie.garantie_jusqu IS 'Warranty expiration date';


--
-- Name: numeros_serie_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.numeros_serie_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.numeros_serie_id_seq OWNER TO postgres;

--
-- Name: numeros_serie_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.numeros_serie_id_seq OWNED BY public.numeros_serie.id;


--
-- Name: paiements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.paiements (
    id integer NOT NULL,
    facture_id integer NOT NULL,
    montant numeric(15,2) NOT NULL,
    methode_paiement character varying(50) NOT NULL,
    date_paiement timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    reference character varying(100),
    notes text,
    session_caisse_id integer,
    cree_par integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    magasin_id integer,
    idempotency_key character varying(80),
    mouvement_caisse_id integer,
    source character varying(30) DEFAULT 'direct'::character varying NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp without time zone,
    CONSTRAINT chk_paiement_source CHECK (((source)::text = ANY ((ARRAY['direct'::character varying, 'acompte_application'::character varying, 'reversal'::character varying])::text[]))),
    CONSTRAINT paiements_methode_paiement_check CHECK (((methode_paiement)::text = ANY ((ARRAY['espece'::character varying, 'carte'::character varying, 'cheque'::character varying, 'virement'::character varying, 'mobile_money'::character varying, 'orange_money'::character varying, 'mtn_money'::character varying, 'wave'::character varying])::text[])))
);


ALTER TABLE public.paiements OWNER TO postgres;

--
-- Name: COLUMN paiements.session_caisse_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.paiements.session_caisse_id IS 'Cash register session this payment belongs to';


--
-- Name: COLUMN paiements.magasin_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.paiements.magasin_id IS 'Store where this payment was received - required for cash transactions';


--
-- Name: paiements_fournisseur; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.paiements_fournisseur (
    id integer NOT NULL,
    facture_id integer NOT NULL,
    montant numeric(15,2) NOT NULL,
    methode_paiement character varying(50) NOT NULL,
    date_paiement timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    reference character varying(100),
    notes text,
    effectue_par integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    magasin_id integer,
    source character varying(30) DEFAULT 'direct'::character varying NOT NULL,
    mouvement_caisse_id integer,
    session_caisse_id integer,
    idempotency_key character varying(80),
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp without time zone,
    CONSTRAINT chk_pf_source CHECK (((source)::text = ANY ((ARRAY['direct'::character varying, 'acompte_application'::character varying, 'reversal'::character varying])::text[]))),
    CONSTRAINT paiements_fournisseur_methode_paiement_check CHECK (((methode_paiement)::text = ANY ((ARRAY['espece'::character varying, 'carte'::character varying, 'cheque'::character varying, 'virement'::character varying, 'mobile_money'::character varying, 'orange_money'::character varying, 'mtn_money'::character varying, 'wave'::character varying])::text[])))
);


ALTER TABLE public.paiements_fournisseur OWNER TO postgres;

--
-- Name: COLUMN paiements_fournisseur.magasin_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.paiements_fournisseur.magasin_id IS 'Store from which this supplier payment was made - required for cash transactions';


--
-- Name: paiements_fournisseur_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.paiements_fournisseur_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.paiements_fournisseur_id_seq OWNER TO postgres;

--
-- Name: paiements_fournisseur_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.paiements_fournisseur_id_seq OWNED BY public.paiements_fournisseur.id;


--
-- Name: paiements_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.paiements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.paiements_id_seq OWNER TO postgres;

--
-- Name: paiements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.paiements_id_seq OWNED BY public.paiements.id;


--
-- Name: periodes_comptables; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.periodes_comptables (
    id integer NOT NULL,
    exercice integer NOT NULL,
    periode integer NOT NULL,
    date_debut date NOT NULL,
    date_fin date NOT NULL,
    statut character varying(20) DEFAULT 'ouverte'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT periodes_comptables_periode_check CHECK (((periode >= 1) AND (periode <= 12))),
    CONSTRAINT periodes_comptables_statut_check CHECK (((statut)::text = ANY ((ARRAY['ouverte'::character varying, 'fermee'::character varying])::text[])))
);


ALTER TABLE public.periodes_comptables OWNER TO postgres;

--
-- Name: periodes_comptables_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.periodes_comptables_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.periodes_comptables_id_seq OWNER TO postgres;

--
-- Name: periodes_comptables_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.periodes_comptables_id_seq OWNED BY public.periodes_comptables.id;


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.permissions (
    id integer NOT NULL,
    code character varying(100) NOT NULL,
    nom character varying(255) NOT NULL,
    description text,
    module character varying(50) NOT NULL
);


ALTER TABLE public.permissions OWNER TO postgres;

--
-- Name: permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.permissions_id_seq OWNER TO postgres;

--
-- Name: permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.permissions_id_seq OWNED BY public.permissions.id;


--
-- Name: plan_comptable; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.plan_comptable (
    id integer NOT NULL,
    numero character varying(20) NOT NULL,
    intitule character varying(255) NOT NULL,
    type_compte character varying(50) NOT NULL,
    categorie character varying(50),
    actif boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT plan_comptable_type_compte_check CHECK (((type_compte)::text = ANY ((ARRAY['actif'::character varying, 'passif'::character varying, 'capitaux_propres'::character varying, 'charge'::character varying, 'produit'::character varying])::text[])))
);


ALTER TABLE public.plan_comptable OWNER TO postgres;

--
-- Name: plan_comptable_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.plan_comptable_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.plan_comptable_id_seq OWNER TO postgres;

--
-- Name: plan_comptable_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.plan_comptable_id_seq OWNED BY public.plan_comptable.id;


--
-- Name: pos_cart_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pos_cart_items (
    id integer NOT NULL,
    session_id integer,
    produit_id integer,
    quantite integer DEFAULT 1 NOT NULL,
    prix_unitaire numeric(15,2) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.pos_cart_items OWNER TO postgres;

--
-- Name: TABLE pos_cart_items; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.pos_cart_items IS 'Quick cart items for POS checkout';


--
-- Name: pos_cart_items_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.pos_cart_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pos_cart_items_id_seq OWNER TO postgres;

--
-- Name: pos_cart_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.pos_cart_items_id_seq OWNED BY public.pos_cart_items.id;


--
-- Name: pos_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pos_sessions (
    id integer NOT NULL,
    utilisateur_id integer,
    date_ouverture timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    date_fermeture timestamp without time zone,
    solde_ouverture numeric(15,2) DEFAULT 0.00,
    total_ventes numeric(15,2) DEFAULT 0.00,
    nombre_ventes integer DEFAULT 0,
    statut character varying(20) DEFAULT 'ouverte'::character varying,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    location_id integer,
    CONSTRAINT pos_sessions_statut_check CHECK (((statut)::text = ANY ((ARRAY['ouverte'::character varying, 'fermee'::character varying])::text[])))
);


ALTER TABLE public.pos_sessions OWNER TO postgres;

--
-- Name: TABLE pos_sessions; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.pos_sessions IS 'POS terminal sessions for walk-in sales';


--
-- Name: COLUMN pos_sessions.location_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.pos_sessions.location_id IS 'Location where the POS session operates';


--
-- Name: pos_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.pos_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pos_sessions_id_seq OWNER TO postgres;

--
-- Name: pos_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.pos_sessions_id_seq OWNED BY public.pos_sessions.id;


--
-- Name: produits; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.produits (
    id integer NOT NULL,
    reference character varying(50) NOT NULL,
    nom character varying(255) NOT NULL,
    description text,
    categorie character varying(100),
    prix_achat numeric(15,2) DEFAULT 0.00 NOT NULL,
    prix_vente numeric(15,2) DEFAULT 0.00 NOT NULL,
    stock integer DEFAULT 0 NOT NULL,
    stock_min integer DEFAULT 5 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    fournisseur_id integer,
    cree_par integer,
    modifie_par integer,
    deleted_at timestamp without time zone,
    code_barre character varying(50),
    image_url character varying(500),
    image_thumbnail character varying(500),
    suivi_lot boolean DEFAULT false,
    suivi_serial boolean DEFAULT false,
    garantie_mois integer DEFAULT 0,
    CONSTRAINT chk_stock_non_negative CHECK ((stock >= 0)),
    CONSTRAINT produits_stock_nonnegative CHECK ((stock >= 0))
);


ALTER TABLE public.produits OWNER TO postgres;

--
-- Name: COLUMN produits.stock; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.produits.stock IS 'DEPRECATED: Cache column maintained by trigger from stock_par_location. Use stock_par_location for all stock operations.';


--
-- Name: COLUMN produits.image_url; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.produits.image_url IS 'URL to product image (S3 or local storage)';


--
-- Name: COLUMN produits.image_thumbnail; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.produits.image_thumbnail IS 'URL to thumbnail version';


--
-- Name: COLUMN produits.suivi_lot; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.produits.suivi_lot IS 'Enable lot tracking for this product';


--
-- Name: COLUMN produits.suivi_serial; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.produits.suivi_serial IS 'Enable serial number tracking for this product';


--
-- Name: COLUMN produits.garantie_mois; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.produits.garantie_mois IS 'Default warranty period in months';


--
-- Name: produits_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.produits_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.produits_id_seq OWNER TO postgres;

--
-- Name: produits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.produits_id_seq OWNED BY public.produits.id;


--
-- Name: reception_lignes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.reception_lignes (
    id integer NOT NULL,
    reception_id integer NOT NULL,
    produit_id integer NOT NULL,
    quantite_commandee integer NOT NULL,
    quantite_recue integer NOT NULL,
    cout_unitaire numeric(15,2) NOT NULL,
    total_ligne numeric(15,2) NOT NULL,
    ecart integer DEFAULT 0,
    notes text,
    lot_id integer
);


ALTER TABLE public.reception_lignes OWNER TO postgres;

--
-- Name: reception_lignes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.reception_lignes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.reception_lignes_id_seq OWNER TO postgres;

--
-- Name: reception_lignes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.reception_lignes_id_seq OWNED BY public.reception_lignes.id;


--
-- Name: reception_numero_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.reception_numero_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.reception_numero_seq OWNER TO postgres;

--
-- Name: receptions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.receptions (
    id integer NOT NULL,
    commande_id integer NOT NULL,
    numero_reception character varying(50) NOT NULL,
    date_reception timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    receptionne_par integer,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    location_id integer
);


ALTER TABLE public.receptions OWNER TO postgres;

--
-- Name: COLUMN receptions.location_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.receptions.location_id IS 'Location where goods were physically received';


--
-- Name: receptions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.receptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.receptions_id_seq OWNER TO postgres;

--
-- Name: receptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.receptions_id_seq OWNED BY public.receptions.id;


--
-- Name: retour_lignes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.retour_lignes (
    id integer NOT NULL,
    retour_id integer NOT NULL,
    facture_id integer NOT NULL,
    produit_id integer NOT NULL,
    quantite integer DEFAULT 1 NOT NULL,
    raison character varying(500) NOT NULL,
    prix_unitaire numeric(15,2) NOT NULL,
    total_ligne numeric(15,2) NOT NULL,
    notes text
);


ALTER TABLE public.retour_lignes OWNER TO postgres;

--
-- Name: retour_lignes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.retour_lignes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.retour_lignes_id_seq OWNER TO postgres;

--
-- Name: retour_lignes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.retour_lignes_id_seq OWNED BY public.retour_lignes.id;


--
-- Name: retours; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.retours (
    id integer NOT NULL,
    numero_retour character varying(50) NOT NULL,
    tiers_id integer NOT NULL,
    date_retour timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    total_remboursement numeric(15,2) DEFAULT 0.00,
    statut character varying(20) DEFAULT 'en_attente'::character varying,
    notes text,
    cree_par integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT retours_statut_check CHECK (((statut)::text = ANY ((ARRAY['en_attente'::character varying, 'traite'::character varying, 'annule'::character varying])::text[])))
);


ALTER TABLE public.retours OWNER TO postgres;

--
-- Name: retours_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.retours_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.retours_id_seq OWNER TO postgres;

--
-- Name: retours_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.retours_id_seq OWNED BY public.retours.id;


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.role_permissions (
    role_id integer NOT NULL,
    permission_id integer NOT NULL
);


ALTER TABLE public.role_permissions OWNER TO postgres;

--
-- Name: roles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.roles (
    id integer NOT NULL,
    nom character varying(100) NOT NULL,
    description text,
    is_system boolean DEFAULT false
);


ALTER TABLE public.roles OWNER TO postgres;

--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.roles_id_seq OWNER TO postgres;

--
-- Name: roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.roles_id_seq OWNED BY public.roles.id;


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sessions (
    id integer NOT NULL,
    utilisateur_id integer NOT NULL,
    token_hash character varying(255) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.sessions OWNER TO postgres;

--
-- Name: sessions_caisse; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sessions_caisse (
    id integer NOT NULL,
    utilisateur_id integer,
    date_ouverture timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    date_cloture timestamp without time zone,
    solde_ouverture numeric(15,2) DEFAULT 0.00 NOT NULL,
    solde_fermeture numeric(15,2),
    solde_theorique numeric(15,2),
    ecart numeric(15,2),
    notes_ouverture text,
    notes_fermeture text,
    statut character varying(20) DEFAULT 'ouverte'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    caisse_id integer,
    magasin_id integer NOT NULL,
    ouverte_par_user_id integer NOT NULL,
    cloturee_par_user_id integer,
    fond_initial numeric(15,2),
    fond_final_compte numeric(15,2),
    solde_theorique_cloture numeric(15,2),
    commentaire_ouverture text,
    commentaire_cloture text,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    totaux_par_methode jsonb,
    expected_cash numeric(15,2),
    CONSTRAINT sessions_caisse_statut_check CHECK (((statut)::text = ANY ((ARRAY['ouverte'::character varying, 'cloturee'::character varying])::text[])))
);


ALTER TABLE public.sessions_caisse OWNER TO postgres;

--
-- Name: TABLE sessions_caisse; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.sessions_caisse IS 'Sessions de caisse quotidiennes';


--
-- Name: COLUMN sessions_caisse.ecart; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.sessions_caisse.ecart IS ' fond_final_compte - solde_theorique_cloture';


--
-- Name: COLUMN sessions_caisse.magasin_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.sessions_caisse.magasin_id IS 'Store this cash session belongs to - each magasin has one open session max';


--
-- Name: COLUMN sessions_caisse.ouverte_par_user_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.sessions_caisse.ouverte_par_user_id IS 'User who opened this session';


--
-- Name: COLUMN sessions_caisse.cloturee_par_user_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.sessions_caisse.cloturee_par_user_id IS 'User who closed this session';


--
-- Name: COLUMN sessions_caisse.fond_initial; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.sessions_caisse.fond_initial IS 'Physical cash count at opening (FCFA)';


--
-- Name: COLUMN sessions_caisse.fond_final_compte; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.sessions_caisse.fond_final_compte IS 'Physical cash count at closing (FCFA)';


--
-- Name: COLUMN sessions_caisse.solde_theorique_cloture; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.sessions_caisse.solde_theorique_cloture IS 'Calculated: fond_initial + encaissements - decaissements';


--
-- Name: COLUMN sessions_caisse.commentaire_cloture; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.sessions_caisse.commentaire_cloture IS 'Required if ecart != 0';


--
-- Name: sessions_caisse_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.sessions_caisse_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.sessions_caisse_id_seq OWNER TO postgres;

--
-- Name: sessions_caisse_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.sessions_caisse_id_seq OWNED BY public.sessions_caisse.id;


--
-- Name: sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.sessions_id_seq OWNER TO postgres;

--
-- Name: sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.sessions_id_seq OWNED BY public.sessions.id;


--
-- Name: shifts_employes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.shifts_employes (
    id integer NOT NULL,
    employe_id integer NOT NULL,
    date_shift date NOT NULL,
    heure_prevue_debut time without time zone,
    heure_prevue_fin time without time zone,
    heure_debut time without time zone,
    heure_fin time without time zone,
    statut character varying(20) DEFAULT 'prevu'::character varying,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT shifts_employes_statut_check CHECK (((statut)::text = ANY ((ARRAY['prevu'::character varying, 'en_cours'::character varying, 'termine'::character varying, 'absent'::character varying])::text[])))
);


ALTER TABLE public.shifts_employes OWNER TO postgres;

--
-- Name: shifts_employes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.shifts_employes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.shifts_employes_id_seq OWNER TO postgres;

--
-- Name: shifts_employes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.shifts_employes_id_seq OWNED BY public.shifts_employes.id;


--
-- Name: stock_locations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stock_locations (
    id integer NOT NULL,
    code character varying(20) NOT NULL,
    nom character varying(100) NOT NULL,
    adresse text,
    responsable_id integer,
    actif boolean DEFAULT true,
    est_principal boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    location_type character varying(20) NOT NULL,
    CONSTRAINT stock_locations_location_type_check CHECK (((location_type)::text = ANY ((ARRAY['depot'::character varying, 'magasin'::character varying])::text[])))
);


ALTER TABLE public.stock_locations OWNER TO postgres;

--
-- Name: stock_locations_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.stock_locations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.stock_locations_id_seq OWNER TO postgres;

--
-- Name: stock_locations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.stock_locations_id_seq OWNED BY public.stock_locations.id;


--
-- Name: stock_par_location; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stock_par_location (
    id integer NOT NULL,
    produit_id integer NOT NULL,
    location_id integer NOT NULL,
    quantite integer DEFAULT 0 NOT NULL,
    quantite_reservee integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT stock_par_location_quantite_check CHECK ((quantite >= 0)),
    CONSTRAINT stock_par_location_quantite_reservee_check CHECK ((quantite_reservee >= 0))
);


ALTER TABLE public.stock_par_location OWNER TO postgres;

--
-- Name: stock_par_location_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.stock_par_location_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.stock_par_location_id_seq OWNER TO postgres;

--
-- Name: stock_par_location_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.stock_par_location_id_seq OWNED BY public.stock_par_location.id;


--
-- Name: stock_transfer_lignes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stock_transfer_lignes (
    id integer NOT NULL,
    transfer_id integer NOT NULL,
    produit_id integer NOT NULL,
    quantite_demandee integer DEFAULT 1 NOT NULL,
    quantite_transferee integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    demande_ligne_id integer
);


ALTER TABLE public.stock_transfer_lignes OWNER TO postgres;

--
-- Name: stock_transfer_lignes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.stock_transfer_lignes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.stock_transfer_lignes_id_seq OWNER TO postgres;

--
-- Name: stock_transfer_lignes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.stock_transfer_lignes_id_seq OWNED BY public.stock_transfer_lignes.id;


--
-- Name: stock_transfers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stock_transfers (
    id integer NOT NULL,
    numero_transfer character varying(50) NOT NULL,
    location_source_id integer NOT NULL,
    location_destination_id integer NOT NULL,
    date_transfer timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    statut public.transfer_statut_new DEFAULT 'en_preparation'::public.transfer_statut_new,
    notes text,
    cree_par integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    demande_id integer
);


ALTER TABLE public.stock_transfers OWNER TO postgres;

--
-- Name: stock_transfers_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.stock_transfers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.stock_transfers_id_seq OWNER TO postgres;

--
-- Name: stock_transfers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.stock_transfers_id_seq OWNED BY public.stock_transfers.id;


--
-- Name: taux_tva; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.taux_tva (
    id integer NOT NULL,
    code character varying(20) NOT NULL,
    taux numeric(5,2) NOT NULL,
    description text,
    actif boolean DEFAULT true,
    date_debut date DEFAULT CURRENT_DATE,
    date_fin date,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.taux_tva OWNER TO postgres;

--
-- Name: TABLE taux_tva; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.taux_tva IS 'Configuration des taux de TVA';


--
-- Name: taux_tva_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.taux_tva_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.taux_tva_id_seq OWNER TO postgres;

--
-- Name: taux_tva_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.taux_tva_id_seq OWNED BY public.taux_tva.id;


--
-- Name: three_way_match_details_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.three_way_match_details_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.three_way_match_details_id_seq OWNER TO postgres;

--
-- Name: three_way_match_details_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.three_way_match_details_id_seq OWNED BY public._deprecated_three_way_match_details_2026_05.id;


--
-- Name: three_way_matches_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.three_way_matches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.three_way_matches_id_seq OWNER TO postgres;

--
-- Name: three_way_matches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.three_way_matches_id_seq OWNED BY public._deprecated_three_way_matches_2026_05.id;


--
-- Name: tiers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tiers (
    id integer NOT NULL,
    code character varying(20) NOT NULL,
    raison_sociale character varying(255) NOT NULL,
    prenom character varying(100),
    telephone character varying(20),
    email character varying(255),
    adresse text,
    nif character varying(50),
    rccm character varying(50),
    est_client boolean DEFAULT false NOT NULL,
    est_fournisseur boolean DEFAULT false NOT NULL,
    credit_max numeric(15,2) DEFAULT 0.00,
    credit_encours numeric(15,2) DEFAULT 0.00,
    delai_paiement character varying(50),
    solde_client_actuel numeric(15,2) DEFAULT 0.00,
    acompte_client_disponible numeric(15,2) DEFAULT 0.00,
    solde_fournisseur_actuel numeric(15,2) DEFAULT 0.00,
    delai_livraison integer DEFAULT 7,
    notes text,
    deleted_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT tiers_at_least_one_role CHECK ((est_client OR est_fournisseur))
);


ALTER TABLE public.tiers OWNER TO postgres;

--
-- Name: TABLE tiers; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.tiers IS 'Unified third-party table: a tiers can be client, fournisseur, or both simultaneously';


--
-- Name: COLUMN tiers.est_client; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.tiers.est_client IS 'True if this tiers buys from us (client role)';


--
-- Name: COLUMN tiers.est_fournisseur; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.tiers.est_fournisseur IS 'True if this tiers sells to us (fournisseur role)';


--
-- Name: COLUMN tiers.solde_client_actuel; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.tiers.solde_client_actuel IS 'Cached: sum of outstanding client invoices (positive = tiers owes us)';


--
-- Name: COLUMN tiers.solde_fournisseur_actuel; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.tiers.solde_fournisseur_actuel IS 'Cached: sum of outstanding supplier invoices (positive = we owe tiers)';


--
-- Name: tiers_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.tiers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.tiers_id_seq OWNER TO postgres;

--
-- Name: tiers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.tiers_id_seq OWNED BY public.tiers.id;


--
-- Name: transfer_numero_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.transfer_numero_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.transfer_numero_seq OWNER TO postgres;

--
-- Name: transfert_caisse_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.transfert_caisse_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.transfert_caisse_seq OWNER TO postgres;

--
-- Name: transferts_caisse; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.transferts_caisse (
    id integer NOT NULL,
    numero_transfert character varying(50) NOT NULL,
    caisse_source_id integer NOT NULL,
    caisse_dest_id integer NOT NULL,
    montant numeric(15,2) NOT NULL,
    date_transfert timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    statut character varying(20) DEFAULT 'en_attente'::character varying,
    cree_par integer,
    valide_par integer,
    date_validation timestamp without time zone,
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT transferts_caisse_montant_check CHECK ((montant > (0)::numeric)),
    CONSTRAINT transferts_caisse_statut_check CHECK (((statut)::text = ANY ((ARRAY['en_attente'::character varying, 'valide'::character varying, 'annule'::character varying])::text[])))
);


ALTER TABLE public.transferts_caisse OWNER TO postgres;

--
-- Name: TABLE transferts_caisse; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.transferts_caisse IS 'Fund transfers between caisses';


--
-- Name: transferts_caisse_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.transferts_caisse_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.transferts_caisse_id_seq OWNER TO postgres;

--
-- Name: transferts_caisse_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.transferts_caisse_id_seq OWNED BY public.transferts_caisse.id;


--
-- Name: user_location_roles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_location_roles (
    id integer NOT NULL,
    utilisateur_id integer NOT NULL,
    location_id integer NOT NULL,
    role_at_location character varying(20) NOT NULL,
    est_defaut boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_location_roles_role_at_location_check CHECK (((role_at_location)::text = ANY ((ARRAY['depot_staff'::character varying, 'magasin_staff'::character varying, 'both'::character varying])::text[])))
);


ALTER TABLE public.user_location_roles OWNER TO postgres;

--
-- Name: user_location_roles_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.user_location_roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.user_location_roles_id_seq OWNER TO postgres;

--
-- Name: user_location_roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.user_location_roles_id_seq OWNED BY public.user_location_roles.id;


--
-- Name: user_permissions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_permissions (
    utilisateur_id integer NOT NULL,
    permission_id integer NOT NULL
);


ALTER TABLE public.user_permissions OWNER TO postgres;

--
-- Name: user_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_sessions (
    id integer NOT NULL,
    utilisateur_id integer NOT NULL,
    token_hash character varying(255) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamp without time zone NOT NULL,
    revoked_at timestamp without time zone,
    ip_address character varying(45),
    user_agent text,
    is_active boolean DEFAULT true
);


ALTER TABLE public.user_sessions OWNER TO postgres;

--
-- Name: TABLE user_sessions; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.user_sessions IS 'Session tracking for token revocation';


--
-- Name: user_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.user_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.user_sessions_id_seq OWNER TO postgres;

--
-- Name: user_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.user_sessions_id_seq OWNED BY public.user_sessions.id;


--
-- Name: utilisateur_locations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.utilisateur_locations (
    id integer NOT NULL,
    utilisateur_id integer NOT NULL,
    location_id integer NOT NULL,
    est_defaut boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.utilisateur_locations OWNER TO postgres;

--
-- Name: TABLE utilisateur_locations; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.utilisateur_locations IS 'Authorized stock locations per user';


--
-- Name: COLUMN utilisateur_locations.est_defaut; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.utilisateur_locations.est_defaut IS 'Default working location for the user';


--
-- Name: utilisateur_locations_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.utilisateur_locations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.utilisateur_locations_id_seq OWNER TO postgres;

--
-- Name: utilisateur_locations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.utilisateur_locations_id_seq OWNED BY public.utilisateur_locations.id;


--
-- Name: utilisateurs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.utilisateurs (
    id integer NOT NULL,
    username character varying(100) NOT NULL,
    email character varying(255),
    password_hash character varying(255) NOT NULL,
    nom_complet character varying(255),
    actif boolean DEFAULT true NOT NULL,
    dernier_login timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    must_change_password boolean DEFAULT false NOT NULL,
    role_id integer NOT NULL,
    customiser_permissions boolean DEFAULT false
);


ALTER TABLE public.utilisateurs OWNER TO postgres;

--
-- Name: utilisateurs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.utilisateurs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.utilisateurs_id_seq OWNER TO postgres;

--
-- Name: utilisateurs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.utilisateurs_id_seq OWNED BY public.utilisateurs.id;


--
-- Name: v_caisse_audit; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_caisse_audit AS
 SELECT 'acompte_client'::text AS source_kind,
    a.id AS source_id,
    a.tiers_id,
    a.montant,
    a.methode_paiement,
    a.date_acompte AS source_date,
    a.session_caisse_id,
    a.mouvement_caisse_id,
    a.magasin_id,
        CASE
            WHEN (((a.methode_paiement)::text = 'espece'::text) AND (a.mouvement_caisse_id IS NULL)) THEN true
            ELSE false
        END AS is_orphan
   FROM public.acomptes_clients a
  WHERE (a.deleted_at IS NULL)
UNION ALL
 SELECT 'acompte_fournisseur'::text AS source_kind,
    af.id AS source_id,
    af.tiers_id,
    af.montant,
    af.methode_paiement,
    af.date_acompte AS source_date,
    af.session_caisse_id,
    af.mouvement_caisse_id,
    af.magasin_id,
        CASE
            WHEN (((af.methode_paiement)::text = 'espece'::text) AND (af.mouvement_caisse_id IS NULL)) THEN true
            ELSE false
        END AS is_orphan
   FROM public.acomptes_fournisseur af
  WHERE (af.deleted_at IS NULL)
UNION ALL
 SELECT 'paiement'::text AS source_kind,
    p.id AS source_id,
    f.tiers_id,
    p.montant,
    p.methode_paiement,
    p.date_paiement AS source_date,
    p.session_caisse_id,
    p.mouvement_caisse_id,
    NULL::integer AS magasin_id,
        CASE
            WHEN (((p.methode_paiement)::text = 'espece'::text) AND ((p.source)::text = 'direct'::text) AND (p.mouvement_caisse_id IS NULL)) THEN true
            ELSE false
        END AS is_orphan
   FROM (public.paiements p
     JOIN public.factures f ON ((p.facture_id = f.id)))
  WHERE (p.deleted_at IS NULL);


ALTER VIEW public.v_caisse_audit OWNER TO postgres;

--
-- Name: VIEW v_caisse_audit; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON VIEW public.v_caisse_audit IS 'Unified ledger: every money-in/out source. is_orphan=true → cash event missing mouvements_caisse link.';


--
-- Name: v_demandes_reapprovisionnement; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_demandes_reapprovisionnement AS
 SELECT d.id,
    d.numero,
    d.magasin_id,
    d.depot_id,
    d.statut,
    d.created_by_user_id,
    d.decided_by_user_id,
    d.executed_by_user_id,
    d.closed_by_user_id,
    d.date_creation,
    d.date_envoi,
    d.date_decision,
    d.date_execution,
    d.date_livraison,
    d.date_cloture,
    d.motif,
    d.raison_refus,
    d.transfert_id,
    d.updated_at,
    m.code AS magasin_code,
    m.nom AS magasin_nom,
    dp.code AS depot_code,
    dp.nom AS depot_nom,
    u1.username AS created_by_username,
    u1.nom_complet AS created_by_nom,
    u2.username AS decided_by_username,
    u2.nom_complet AS decided_by_nom,
    u3.username AS executed_by_username,
    u3.nom_complet AS executed_by_nom,
    u4.username AS closed_by_username,
    u4.nom_complet AS closed_by_nom,
    st.numero_transfer
   FROM (((((((public.demandes_reapprovisionnement d
     JOIN public.stock_locations m ON ((d.magasin_id = m.id)))
     JOIN public.stock_locations dp ON ((d.depot_id = dp.id)))
     LEFT JOIN public.utilisateurs u1 ON ((d.created_by_user_id = u1.id)))
     LEFT JOIN public.utilisateurs u2 ON ((d.decided_by_user_id = u2.id)))
     LEFT JOIN public.utilisateurs u3 ON ((d.executed_by_user_id = u3.id)))
     LEFT JOIN public.utilisateurs u4 ON ((d.closed_by_user_id = u4.id)))
     LEFT JOIN public.stock_transfers st ON ((d.transfert_id = st.id)));


ALTER VIEW public.v_demandes_reapprovisionnement OWNER TO postgres;

--
-- Name: VIEW v_demandes_reapprovisionnement; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON VIEW public.v_demandes_reapprovisionnement IS 'Convenience view for demande details with related data';


--
-- Name: vue_session_methode_totaux; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.vue_session_methode_totaux AS
 SELECT session_caisse_id,
    methode_paiement,
    COALESCE(sum(
        CASE
            WHEN ((type)::text = 'encaissement'::text) THEN montant
            ELSE (0)::numeric
        END), (0)::numeric) AS total_encaissements,
    COALESCE(sum(
        CASE
            WHEN ((type)::text = 'decaissement'::text) THEN montant
            ELSE (0)::numeric
        END), (0)::numeric) AS total_decaissements,
    count(*) AS nb_mouvements
   FROM public.mouvements_caisse mc
  GROUP BY session_caisse_id, methode_paiement;


ALTER VIEW public.vue_session_methode_totaux OWNER TO postgres;

--
-- Name: VIEW vue_session_methode_totaux; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON VIEW public.vue_session_methode_totaux IS 'Per-session, per-method cash flow totals â€” used by day-close';


--
-- Name: _deprecated_internal_stock_request_lignes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._deprecated_internal_stock_request_lignes ALTER COLUMN id SET DEFAULT nextval('public.internal_stock_request_lignes_id_seq'::regclass);


--
-- Name: _deprecated_internal_stock_requests id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._deprecated_internal_stock_requests ALTER COLUMN id SET DEFAULT nextval('public.internal_stock_requests_id_seq'::regclass);


--
-- Name: _deprecated_three_way_match_details_2026_05 id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._deprecated_three_way_match_details_2026_05 ALTER COLUMN id SET DEFAULT nextval('public.three_way_match_details_id_seq'::regclass);


--
-- Name: _deprecated_three_way_matches_2026_05 id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._deprecated_three_way_matches_2026_05 ALTER COLUMN id SET DEFAULT nextval('public.three_way_matches_id_seq'::regclass);


--
-- Name: acompte_applications id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acompte_applications ALTER COLUMN id SET DEFAULT nextval('public.acompte_applications_id_seq'::regclass);


--
-- Name: acompte_applications_fournisseur id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acompte_applications_fournisseur ALTER COLUMN id SET DEFAULT nextval('public.acompte_applications_fournisseur_id_seq'::regclass);


--
-- Name: acomptes_clients id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acomptes_clients ALTER COLUMN id SET DEFAULT nextval('public.acomptes_clients_id_seq'::regclass);


--
-- Name: acomptes_fournisseur id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acomptes_fournisseur ALTER COLUMN id SET DEFAULT nextval('public.acomptes_fournisseur_id_seq'::regclass);


--
-- Name: allocation_audit id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_audit ALTER COLUMN id SET DEFAULT nextval('public.allocation_audit_id_seq'::regclass);


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: barcode_scans id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.barcode_scans ALTER COLUMN id SET DEFAULT nextval('public.barcode_scans_id_seq'::regclass);


--
-- Name: bon_livraison_lignes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bon_livraison_lignes ALTER COLUMN id SET DEFAULT nextval('public.bon_livraison_lignes_id_seq'::regclass);


--
-- Name: bons_livraison id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bons_livraison ALTER COLUMN id SET DEFAULT nextval('public.bons_livraison_id_seq'::regclass);


--
-- Name: caisses id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.caisses ALTER COLUMN id SET DEFAULT nextval('public.caisses_id_seq'::regclass);


--
-- Name: categories_depenses id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories_depenses ALTER COLUMN id SET DEFAULT nextval('public.categories_depenses_id_seq'::regclass);


--
-- Name: commande_lignes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.commande_lignes ALTER COLUMN id SET DEFAULT nextval('public.commande_lignes_id_seq'::regclass);


--
-- Name: commandes_fournisseur id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.commandes_fournisseur ALTER COLUMN id SET DEFAULT nextval('public.commandes_fournisseur_id_seq'::regclass);


--
-- Name: compensations id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.compensations ALTER COLUMN id SET DEFAULT nextval('public.compensations_id_seq'::regclass);


--
-- Name: compte_client_lignes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.compte_client_lignes ALTER COLUMN id SET DEFAULT nextval('public.compte_client_lignes_id_seq'::regclass);


--
-- Name: compte_fournisseur_lignes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.compte_fournisseur_lignes ALTER COLUMN id SET DEFAULT nextval('public.compte_fournisseur_lignes_id_seq'::regclass);


--
-- Name: demandes_reapprovisionnement id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.demandes_reapprovisionnement ALTER COLUMN id SET DEFAULT nextval('public.demandes_reapprovisionnement_id_seq'::regclass);


--
-- Name: demandes_reapprovisionnement_history id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.demandes_reapprovisionnement_history ALTER COLUMN id SET DEFAULT nextval('public.demandes_reapprovisionnement_history_id_seq'::regclass);


--
-- Name: demandes_reapprovisionnement_lignes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.demandes_reapprovisionnement_lignes ALTER COLUMN id SET DEFAULT nextval('public.demandes_reapprovisionnement_lignes_id_seq'::regclass);


--
-- Name: depenses id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.depenses ALTER COLUMN id SET DEFAULT nextval('public.depenses_id_seq'::regclass);


--
-- Name: devis id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.devis ALTER COLUMN id SET DEFAULT nextval('public.devis_id_seq'::regclass);


--
-- Name: devis_lignes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.devis_lignes ALTER COLUMN id SET DEFAULT nextval('public.devis_lignes_id_seq'::regclass);


--
-- Name: document_lignes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.document_lignes ALTER COLUMN id SET DEFAULT nextval('public.document_lignes_id_seq'::regclass);


--
-- Name: ecritures_comptables id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ecritures_comptables ALTER COLUMN id SET DEFAULT nextval('public.ecritures_comptables_id_seq'::regclass);


--
-- Name: employes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employes ALTER COLUMN id SET DEFAULT nextval('public.employes_id_seq'::regclass);


--
-- Name: facture_avoir_lignes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.facture_avoir_lignes ALTER COLUMN id SET DEFAULT nextval('public.facture_avoir_lignes_id_seq'::regclass);


--
-- Name: facture_fournisseur_lignes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.facture_fournisseur_lignes ALTER COLUMN id SET DEFAULT nextval('public.facture_fournisseur_lignes_id_seq'::regclass);


--
-- Name: factures id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.factures ALTER COLUMN id SET DEFAULT nextval('public.factures_id_seq'::regclass);


--
-- Name: factures_avoir id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.factures_avoir ALTER COLUMN id SET DEFAULT nextval('public.factures_avoir_id_seq'::regclass);


--
-- Name: factures_fournisseur id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.factures_fournisseur ALTER COLUMN id SET DEFAULT nextval('public.factures_fournisseur_id_seq'::regclass);


--
-- Name: lots id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lots ALTER COLUMN id SET DEFAULT nextval('public.lots_id_seq'::regclass);


--
-- Name: magasins id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.magasins ALTER COLUMN id SET DEFAULT nextval('public.magasins_id_seq'::regclass);


--
-- Name: mouvements_caisse id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mouvements_caisse ALTER COLUMN id SET DEFAULT nextval('public.mouvements_caisse_id_seq'::regclass);


--
-- Name: mouvements_stock id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mouvements_stock ALTER COLUMN id SET DEFAULT nextval('public.mouvements_stock_id_seq'::regclass);


--
-- Name: numeros_serie id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.numeros_serie ALTER COLUMN id SET DEFAULT nextval('public.numeros_serie_id_seq'::regclass);


--
-- Name: paiements id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.paiements ALTER COLUMN id SET DEFAULT nextval('public.paiements_id_seq'::regclass);


--
-- Name: paiements_fournisseur id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.paiements_fournisseur ALTER COLUMN id SET DEFAULT nextval('public.paiements_fournisseur_id_seq'::regclass);


--
-- Name: periodes_comptables id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.periodes_comptables ALTER COLUMN id SET DEFAULT nextval('public.periodes_comptables_id_seq'::regclass);


--
-- Name: permissions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permissions ALTER COLUMN id SET DEFAULT nextval('public.permissions_id_seq'::regclass);


--
-- Name: plan_comptable id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.plan_comptable ALTER COLUMN id SET DEFAULT nextval('public.plan_comptable_id_seq'::regclass);


--
-- Name: pos_cart_items id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pos_cart_items ALTER COLUMN id SET DEFAULT nextval('public.pos_cart_items_id_seq'::regclass);


--
-- Name: pos_sessions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pos_sessions ALTER COLUMN id SET DEFAULT nextval('public.pos_sessions_id_seq'::regclass);


--
-- Name: produits id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.produits ALTER COLUMN id SET DEFAULT nextval('public.produits_id_seq'::regclass);


--
-- Name: reception_lignes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reception_lignes ALTER COLUMN id SET DEFAULT nextval('public.reception_lignes_id_seq'::regclass);


--
-- Name: receptions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.receptions ALTER COLUMN id SET DEFAULT nextval('public.receptions_id_seq'::regclass);


--
-- Name: retour_lignes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.retour_lignes ALTER COLUMN id SET DEFAULT nextval('public.retour_lignes_id_seq'::regclass);


--
-- Name: retours id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.retours ALTER COLUMN id SET DEFAULT nextval('public.retours_id_seq'::regclass);


--
-- Name: roles id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles ALTER COLUMN id SET DEFAULT nextval('public.roles_id_seq'::regclass);


--
-- Name: sessions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sessions ALTER COLUMN id SET DEFAULT nextval('public.sessions_id_seq'::regclass);


--
-- Name: sessions_caisse id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sessions_caisse ALTER COLUMN id SET DEFAULT nextval('public.sessions_caisse_id_seq'::regclass);


--
-- Name: shifts_employes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shifts_employes ALTER COLUMN id SET DEFAULT nextval('public.shifts_employes_id_seq'::regclass);


--
-- Name: stock_locations id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_locations ALTER COLUMN id SET DEFAULT nextval('public.stock_locations_id_seq'::regclass);


--
-- Name: stock_par_location id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_par_location ALTER COLUMN id SET DEFAULT nextval('public.stock_par_location_id_seq'::regclass);


--
-- Name: stock_transfer_lignes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_transfer_lignes ALTER COLUMN id SET DEFAULT nextval('public.stock_transfer_lignes_id_seq'::regclass);


--
-- Name: stock_transfers id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_transfers ALTER COLUMN id SET DEFAULT nextval('public.stock_transfers_id_seq'::regclass);


--
-- Name: taux_tva id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.taux_tva ALTER COLUMN id SET DEFAULT nextval('public.taux_tva_id_seq'::regclass);


--
-- Name: tiers id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tiers ALTER COLUMN id SET DEFAULT nextval('public.tiers_id_seq'::regclass);


--
-- Name: transferts_caisse id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transferts_caisse ALTER COLUMN id SET DEFAULT nextval('public.transferts_caisse_id_seq'::regclass);


--
-- Name: user_location_roles id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_location_roles ALTER COLUMN id SET DEFAULT nextval('public.user_location_roles_id_seq'::regclass);


--
-- Name: user_sessions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_sessions ALTER COLUMN id SET DEFAULT nextval('public.user_sessions_id_seq'::regclass);


--
-- Name: utilisateur_locations id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.utilisateur_locations ALTER COLUMN id SET DEFAULT nextval('public.utilisateur_locations_id_seq'::regclass);


--
-- Name: utilisateurs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.utilisateurs ALTER COLUMN id SET DEFAULT nextval('public.utilisateurs_id_seq'::regclass);


--
-- Data for Name: _deprecated_internal_stock_request_lignes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public._deprecated_internal_stock_request_lignes (id, request_id, produit_id, quantite_demandee, quantite_validee, quantite_transferee, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: _deprecated_internal_stock_requests; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public._deprecated_internal_stock_requests (id, numero_demande, magasin_id, depot_id, statut, notes, motif_refus, transfer_id, cree_par, valide_par, execute_par, date_validation, date_execution, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: _deprecated_three_way_match_details_2026_05; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public._deprecated_three_way_match_details_2026_05 (id, match_id, produit_id, quantite_commandee, quantite_recue, prix_commande, prix_facture, ecart_quantite, ecart_prix, commentaire) FROM stdin;
\.


--
-- Data for Name: _deprecated_three_way_matches_2026_05; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public._deprecated_three_way_matches_2026_05 (id, commande_id, reception_id, facture_fournisseur_id, date_verification, statut, ecart_quantite, ecart_prix, notes, valide_par, created_at) FROM stdin;
\.


--
-- Data for Name: acompte_applications; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.acompte_applications (id, acompte_id, facture_id, paiement_id, montant, date_application, cree_par, notes, created_at) FROM stdin;
\.


--
-- Data for Name: acompte_applications_fournisseur; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.acompte_applications_fournisseur (id, acompte_id, facture_id, paiement_id, montant, date_application, cree_par, notes, created_at) FROM stdin;
\.


--
-- Data for Name: acomptes_clients; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.acomptes_clients (id, tiers_id, montant, methode_paiement, date_acompte, statut, facture_id_applique, date_utilisation, notes, cree_par, created_at, magasin_id, session_caisse_id, mouvement_caisse_id, montant_restant, idempotency_key, reference_number, rembourse_par_user_id, date_remboursement, updated_at, deleted_at) FROM stdin;
\.


--
-- Data for Name: acomptes_fournisseur; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.acomptes_fournisseur (id, tiers_id, montant, methode_paiement, date_acompte, statut, facture_id_applique, date_utilisation, notes, cree_par, created_at, magasin_id, session_caisse_id, mouvement_caisse_id, montant_restant, idempotency_key, reference_number, rembourse_par_user_id, date_remboursement, updated_at, deleted_at) FROM stdin;
\.


--
-- Data for Name: allocation_audit; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.allocation_audit (id, tiers_id, allocation_type, before_data, after_data, created_by, notes, created_at) FROM stdin;
\.


--
-- Data for Name: audit_log; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.audit_log (id, utilisateur_id, action, table_name, record_id, old_values, new_values, ip_address, user_agent, created_at) FROM stdin;
1	1	login	utilisateurs	1	\N	\N	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36	2026-05-18 14:11:24.389213
\.


--
-- Data for Name: barcode_scans; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.barcode_scans (id, code_barre, produit_id, utilisateur_id, date_scan, succes) FROM stdin;
\.


--
-- Data for Name: bon_livraison_lignes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.bon_livraison_lignes (id, bl_id, produit_id, description, quantite_commandee, quantite_livree, prix_unitaire, total_ligne, created_at) FROM stdin;
\.


--
-- Data for Name: bons_livraison; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.bons_livraison (id, numero_bl, tiers_id, devis_id, date_bl, statut, facture_id, sous_total, tva, total, notes, adresse_livraison, date_livraison_prevue, location_id, cree_par, deleted_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: caisses; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.caisses (id, code, nom, type, location_id, caisse_parent_id, solde_actuel, actif, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: categories_depenses; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.categories_depenses (id, code, nom, description, compte_comptable_id, actif, created_at) FROM stdin;
11	LOYER	Loyer	Loyer et charges locatives	\N	t	2026-05-15 16:26:01.544796
12	SALAIRE	Salaires	Salaires et charges sociales	\N	t	2026-05-15 16:26:01.551177
13	TRANSPORT	Transport	Frais de transport et livraison	\N	t	2026-05-15 16:26:01.552307
14	FOURNI	Fournitures	Fournitures de bureau et matériel	\N	t	2026-05-15 16:26:01.553126
15	ELECTRI	Électricité / Eau	Factures eau et électricité	\N	t	2026-05-15 16:26:01.554154
16	TELECOM	Téléphone / Internet	Abonnements télécom et internet	\N	t	2026-05-15 16:26:01.554928
17	REPAS	Repas / Restauration	Repas professionnels	\N	t	2026-05-15 16:26:01.555525
18	ENTRET	Entretien	Entretien et réparations	\N	t	2026-05-15 16:26:01.556276
19	PUBLICI	Publicité	Dépenses marketing et publicité	\N	t	2026-05-15 16:26:01.557798
20	DIVERS	Divers	Autres dépenses non classifiées	\N	t	2026-05-15 16:26:01.559185
\.


--
-- Data for Name: commande_lignes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.commande_lignes (id, commande_id, produit_id, quantite, prix_unitaire, total_ligne) FROM stdin;
\.


--
-- Data for Name: commandes_fournisseur; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.commandes_fournisseur (id, tiers_id, numero_commande, date_commande, date_livraison_prevue, date_livraison_reelle, statut, sous_total, notes, deleted_at, created_at) FROM stdin;
\.


--
-- Data for Name: compensations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.compensations (id, tiers_id, date_compensation, montant, factures_client_ids, factures_fournisseur_ids, ecriture_id, notes, statut, cree_par, created_at) FROM stdin;
\.


--
-- Data for Name: compte_client_lignes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.compte_client_lignes (id, tiers_id, date_operation, type_operation, document_id, document_numero, montant_debit, montant_credit, solde_avant, solde_apres, notes, cree_par, created_at) FROM stdin;
\.


--
-- Data for Name: compte_fournisseur_lignes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.compte_fournisseur_lignes (id, tiers_id, type_operation, document_id, document_numero, montant_debit, montant_credit, notes, cree_par, created_at) FROM stdin;
\.


--
-- Data for Name: demandes_reapprovisionnement; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.demandes_reapprovisionnement (id, numero, magasin_id, depot_id, statut, created_by_user_id, decided_by_user_id, executed_by_user_id, closed_by_user_id, date_creation, date_envoi, date_decision, date_execution, date_livraison, date_cloture, motif, raison_refus, transfert_id, updated_at) FROM stdin;
\.


--
-- Data for Name: demandes_reapprovisionnement_history; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.demandes_reapprovisionnement_history (id, demande_id, from_statut, to_statut, user_id, "timestamp", payload, ip_address, user_agent) FROM stdin;
\.


--
-- Data for Name: demandes_reapprovisionnement_lignes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.demandes_reapprovisionnement_lignes (id, demande_id, produit_id, quantite_demandee, quantite_approuvee, quantite_livree, notes, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: depenses; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.depenses (id, numero_depense, location_id, session_caisse_id, categorie_id, tiers_id, montant, methode_paiement, date_depense, description, justificatif_url, cree_par, created_at, updated_at, magasin_id, mouvement_caisse_id, beneficiaire_libre, deleted_at) FROM stdin;
\.


--
-- Data for Name: devis; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.devis (id, numero_devis, tiers_id, date_devis, date_validite, statut, sous_total, remise_globale, remise_globale_pct, tva, total, total_ht, total_ttc, notes, conditions, location_id, facture_id, cree_par, deleted_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: devis_lignes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.devis_lignes (id, devis_id, produit_id, description, quantite, prix_unitaire, remise_pct, remise_montant, total_ligne, created_at) FROM stdin;
\.


--
-- Data for Name: document_lignes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.document_lignes (id, document_type, document_id, produit_id, description, quantite, quantite_livree, prix_unitaire, remise_pct, remise_montant, total_ligne, parent_ligne_id, created_at) FROM stdin;
\.


--
-- Data for Name: ecritures_comptables; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.ecritures_comptables (id, numero_piece, date_ecriture, journal, piece_id, piece_type, ligne_numero, compte_id, debit, credit, description, created_at) FROM stdin;
\.


--
-- Data for Name: employes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.employes (id, utilisateur_id, matricule, nom_complet, poste, departement, date_embauche, date_naissance, telephone, email, adresse, salaire_base, commission_taux, actif, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: facture_avoir_lignes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.facture_avoir_lignes (id, avoir_id, produit_id, description, quantite, prix_unitaire, taux_tva_id, total_ligne, created_at) FROM stdin;
\.


--
-- Data for Name: facture_fournisseur_lignes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.facture_fournisseur_lignes (id, facture_id, produit_id, description, quantite, prix_unitaire, tva_taux, total_ligne, created_at) FROM stdin;
\.


--
-- Data for Name: factures; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.factures (id, numero_facture, tiers_id, devis_id, bl_id, date_facture, date_echeance, delai_paiement, sous_total, tva, total, total_ht, total_ttc, montant_paye, remaining_due, statut, type_facture, hors_taxe, exoneration_raison, notes, location_id, allocation_version, deleted_at, created_at, cree_par, modifie_par, remise_globale, remise_globale_pct, magasin_id) FROM stdin;
\.


--
-- Data for Name: factures_avoir; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.factures_avoir (id, numero_avoir, tiers_id, facture_origine_id, retour_id, date_avoir, sous_total, tva, total, total_ht, total_ttc, statut, avoir_type, notes, location_id, cree_par, deleted_at, created_at, updated_at, facture_appliquee_id) FROM stdin;
\.


--
-- Data for Name: factures_fournisseur; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.factures_fournisseur (id, tiers_id, reception_id, numero_facture_fournisseur, numero_facture_interne, date_facture, date_echeance, sous_total, tva, total, montant_paye, reste_due, statut, condition_paiement, notes, cree_par, created_at, updated_at, commande_id) FROM stdin;
\.


--
-- Data for Name: lots; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.lots (id, produit_id, numero_lot, date_fabrication, date_expiration, quantite_initiale, quantite_restante, prix_achat_unitaire, fournisseur_id, date_reception, statut, notes, created_at) FROM stdin;
\.


--
-- Data for Name: magasins; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.magasins (id, location_id, code, nom, adresse, telephone, actif, created_at, updated_at) FROM stdin;
1	2	magasin_001	hitek	\N	\N	t	2026-05-06 14:41:23.841414	2026-05-06 14:41:23.841414
2	2	MAG01	hitek	\N	\N	t	2026-05-06 14:41:23.841414	2026-05-06 14:41:23.841414
\.


--
-- Data for Name: mouvements_caisse; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.mouvements_caisse (id, session_caisse_id, facture_id, montant, type_mouvement, methode_paiement, description, date_mouvement, cree_par, type, categorie, reference_type, reference_id, libelle, solde_apres, updated_at, magasin_id, idempotency_key, reversed_by_mouvement_id, reverses_mouvement_id) FROM stdin;
\.


--
-- Data for Name: mouvements_stock; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.mouvements_stock (id, produit_id, type_mouvement, quantite, stock_avant, stock_apres, raison, reference_liee, date_mouvement, lot_id, numero_serie_id, location_id, transfer_id) FROM stdin;
\.


--
-- Data for Name: numeros_serie; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.numeros_serie (id, produit_id, numero_serie, lot_id, statut, date_achat, date_vente, client_id, facture_id, prix_vente, garantie_jusqu, notes, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: paiements; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.paiements (id, facture_id, montant, methode_paiement, date_paiement, reference, notes, session_caisse_id, cree_par, created_at, magasin_id, idempotency_key, mouvement_caisse_id, source, updated_at, deleted_at) FROM stdin;
\.


--
-- Data for Name: paiements_fournisseur; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.paiements_fournisseur (id, facture_id, montant, methode_paiement, date_paiement, reference, notes, effectue_par, created_at, magasin_id, source, mouvement_caisse_id, session_caisse_id, idempotency_key, updated_at, deleted_at) FROM stdin;
\.


--
-- Data for Name: periodes_comptables; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.periodes_comptables (id, exercice, periode, date_debut, date_fin, statut, created_at) FROM stdin;
\.


--
-- Data for Name: permissions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.permissions (id, code, nom, description, module) FROM stdin;
24	dashboard.read	Accéder au tableau de bord	Voir le tableau de bord principal	Dashboard
25	inventaire.read	Voir l'inventaire	Consulter l'inventaire des produits	Inventaire
26	inventaire.write	Modifier l'inventaire	Ajuster les quantités de stock	Inventaire
27	factures.read	Voir les factures	Consulter les factures clients	Ventes
28	factures.create	Créer une facture	Émettre une nouvelle facture	Ventes
29	devis.read	Voir les devis	Consulter les devis	Ventes
30	devis.create	Créer un devis	Émettre un nouveau devis	Ventes
31	bons_livraison.read	Voir les bons de livraison	Consulter les bons de livraison	Ventes
32	bons_livraison.create	Créer un bon de livraison	Émettre un nouveau bon de livraison	Ventes
33	avoirs.read	Voir les avoirs	Consulter les avoirs	Ventes
34	avoirs.create	Créer un avoir	Émettre un nouvel avoir	Ventes
35	commandes.read	Voir les commandes	Consulter les commandes fournisseur	Achats
36	commandes.create	Créer une commande	Émettre une nouvelle commande fournisseur	Achats
37	receptions.read	Voir les réceptions	Consulter les réceptions	Achats
38	receptions.create	Créer une réception	Enregistrer une nouvelle réception	Achats
39	factures_fournisseur.read	Voir les factures fournisseur	Consulter les factures fournisseur	Achats
40	factures_fournisseur.create	Créer une facture fournisseur	Enregistrer une facture fournisseur	Achats
41	tiers.read	Voir les tiers	Consulter clients et fournisseurs	Tiers
42	clients.read	Voir les clients	Consulter la liste des clients	Tiers
43	clients.analytics	Voir analytics clients	Voir les statistiques clients	Tiers
44	fournisseurs.read	Voir les fournisseurs	Consulter la liste des fournisseurs	Tiers
45	employes.read	Voir les employés	Consulter la liste des employés	Tiers
46	stock_locations.read	Voir les emplacements de stock	Consulter les emplacements	Stock
47	stock_transfers.read	Voir les transferts de stock	Consulter les transferts	Stock
48	stock_transfers.create	Créer un transfert de stock	Initier un transfert	Stock
49	demandes.read	Voir les demandes de réapprovisionnement	Consulter les demandes	Stock
50	demandes.create	Créer une demande de réapprovisionnement	Émettre une demande	Stock
51	affectations_locations.read	Voir les affectations	Consulter les affectations d'emplacements	Stock
52	stock_valuation.read	Voir la valorisation du stock	Consulter la valorisation du stock	Stock
53	caisse.read	Accéder à la caisse	Opérer la caisse	Finance
54	caisse.audit	Auditer la caisse	Consulter l'audit de caisse	Finance
55	depenses.read	Voir les dépenses	Consulter les dépenses	Finance
56	depenses.create	Créer une dépense	Enregistrer une nouvelle dépense	Finance
57	general_ledger.read	Voir la comptabilité	Consulter le grand livre	Finance
58	reporting.read	Voir les rapports	Consulter les rapports	Finance
1	users.manage	Gérer les utilisateurs	Créer, modifier, supprimer des utilisateurs	Admin
60	permissions.manage	Gérer les permissions	Modifier les permissions des utilisateurs	Admin
\.


--
-- Data for Name: plan_comptable; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.plan_comptable (id, numero, intitule, type_compte, categorie, actif, created_at) FROM stdin;
1	411	Clients	actif	classe4	t	2026-04-20 10:06:23.176645
2	701	Ventes de marchandises	produit	classe7	t	2026-04-20 10:06:23.176645
3	4457	TVA collectée	passif	classe4	t	2026-04-20 10:06:23.176645
61	601	Achats de marchandises	charge	classe6	t	2026-05-06 14:02:41.47293
62	4456	TVA déductible	actif	classe4	t	2026-05-06 14:02:41.47293
63	401	Fournisseurs	passif	classe4	t	2026-05-06 14:02:41.47293
\.


--
-- Data for Name: pos_cart_items; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.pos_cart_items (id, session_id, produit_id, quantite, prix_unitaire, created_at) FROM stdin;
\.


--
-- Data for Name: pos_sessions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.pos_sessions (id, utilisateur_id, date_ouverture, date_fermeture, solde_ouverture, total_ventes, nombre_ventes, statut, notes, created_at, location_id) FROM stdin;
\.


--
-- Data for Name: produits; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.produits (id, reference, nom, description, categorie, prix_achat, prix_vente, stock, stock_min, created_at, updated_at, fournisseur_id, cree_par, modifie_par, deleted_at, code_barre, image_url, image_thumbnail, suivi_lot, suivi_serial, garantie_mois) FROM stdin;
\.


--
-- Data for Name: reception_lignes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.reception_lignes (id, reception_id, produit_id, quantite_commandee, quantite_recue, cout_unitaire, total_ligne, ecart, notes, lot_id) FROM stdin;
\.


--
-- Data for Name: receptions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.receptions (id, commande_id, numero_reception, date_reception, receptionne_par, notes, created_at, location_id) FROM stdin;
\.


--
-- Data for Name: retour_lignes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.retour_lignes (id, retour_id, facture_id, produit_id, quantite, raison, prix_unitaire, total_ligne, notes) FROM stdin;
\.


--
-- Data for Name: retours; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.retours (id, numero_retour, tiers_id, date_retour, total_remboursement, statut, notes, cree_par, created_at) FROM stdin;
\.


--
-- Data for Name: role_permissions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.role_permissions (role_id, permission_id) FROM stdin;
1	24
1	25
1	26
1	27
1	28
1	29
1	30
1	31
1	32
1	33
1	34
1	35
1	36
1	37
1	38
1	39
1	40
1	41
1	42
1	43
1	44
1	45
1	46
1	47
1	48
1	49
1	50
1	51
1	52
1	53
1	54
1	55
1	56
1	57
1	58
1	1
1	60
2	24
2	25
2	26
2	27
2	28
2	29
2	30
2	31
2	32
2	33
2	34
2	35
2	36
2	37
2	38
2	39
2	40
2	41
2	42
2	43
2	44
2	45
2	46
2	47
2	48
2	49
2	50
2	51
2	52
2	53
2	54
2	55
2	56
2	57
2	58
4	24
4	25
4	35
4	36
4	37
4	38
4	39
4	40
4	44
4	46
4	47
4	48
4	49
4	50
5	24
5	25
5	27
5	28
5	29
5	30
5	31
5	32
5	49
5	50
5	53
5	55
5	56
3	24
3	25
3	27
3	28
3	49
3	50
3	53
3	55
3	56
6	24
6	25
\.


--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.roles (id, nom, description, is_system) FROM stdin;
1	admin	Administrateur système (Accès total)	t
2	manager	Manager magasin	t
3	caissier	Caissier standard	t
4	depot_staff	Personnel de dépôt	t
5	magasin_staff	Personnel de magasin	t
6	viewer	Lecteur seul	t
\.


--
-- Data for Name: sessions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.sessions (id, utilisateur_id, token_hash, expires_at, created_at) FROM stdin;
\.


--
-- Data for Name: sessions_caisse; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.sessions_caisse (id, utilisateur_id, date_ouverture, date_cloture, solde_ouverture, solde_fermeture, solde_theorique, ecart, notes_ouverture, notes_fermeture, statut, created_at, caisse_id, magasin_id, ouverte_par_user_id, cloturee_par_user_id, fond_initial, fond_final_compte, solde_theorique_cloture, commentaire_ouverture, commentaire_cloture, updated_at, totaux_par_methode, expected_cash) FROM stdin;
\.


--
-- Data for Name: shifts_employes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.shifts_employes (id, employe_id, date_shift, heure_prevue_debut, heure_prevue_fin, heure_debut, heure_fin, statut, notes, created_at) FROM stdin;
\.


--
-- Data for Name: stock_locations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.stock_locations (id, code, nom, adresse, responsable_id, actif, est_principal, created_at, updated_at, location_type) FROM stdin;
1	depot_001	depot	\N	\N	t	t	2026-04-17 16:10:14.227013	2026-05-06 11:20:29.805638	depot
2	magasin_001	hitek	\N	\N	t	f	2026-04-17 16:10:34.026809	2026-05-06 11:20:29.805638	magasin
\.


--
-- Data for Name: stock_par_location; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.stock_par_location (id, produit_id, location_id, quantite, quantite_reservee, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: stock_transfer_lignes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.stock_transfer_lignes (id, transfer_id, produit_id, quantite_demandee, quantite_transferee, created_at, demande_ligne_id) FROM stdin;
\.


--
-- Data for Name: stock_transfers; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.stock_transfers (id, numero_transfer, location_source_id, location_destination_id, date_transfer, statut, notes, cree_par, created_at, demande_id) FROM stdin;
\.


--
-- Data for Name: taux_tva; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.taux_tva (id, code, taux, description, actif, date_debut, date_fin, created_at) FROM stdin;
\.


--
-- Data for Name: tiers; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.tiers (id, code, raison_sociale, prenom, telephone, email, adresse, nif, rccm, est_client, est_fournisseur, credit_max, credit_encours, delai_paiement, solde_client_actuel, acompte_client_disponible, solde_fournisseur_actuel, delai_livraison, notes, deleted_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: transferts_caisse; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.transferts_caisse (id, numero_transfert, caisse_source_id, caisse_dest_id, montant, date_transfert, statut, cree_par, valide_par, date_validation, notes, created_at) FROM stdin;
\.


--
-- Data for Name: user_location_roles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_location_roles (id, utilisateur_id, location_id, role_at_location, est_defaut, created_at) FROM stdin;
1	4	1	both	t	2026-05-18 12:15:54.611466
\.


--
-- Data for Name: user_permissions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_permissions (utilisateur_id, permission_id) FROM stdin;
4	36
4	40
4	38
4	35
4	39
4	37
4	26
4	25
4	48
4	50
4	49
4	46
4	47
4	44
\.


--
-- Data for Name: user_sessions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_sessions (id, utilisateur_id, token_hash, created_at, expires_at, revoked_at, ip_address, user_agent, is_active) FROM stdin;
1	1	afba04ab6578986271e80692f7dc0cdca5a3da721cc50f53dd00b9068c0029bc	2026-05-14 17:08:28.897099	2026-05-21 17:08:28.895	\N	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36	t
2	1	8db9177f6c0eb5499ea504606fdd1b3801c34ae01cf29d098d3f2073c72ec281	2026-05-14 17:12:28.253033	2026-05-21 17:12:28.252	\N	::1	curl/8.18.0	t
3	1	044973c4dcbe496ef16fbae630cb3e316677ebaa4a185844f3a83383292f8eaa	2026-05-14 18:10:02.270314	2026-05-21 18:10:02.269	\N	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36	t
4	1	bf2fb83d6a0621ad8d9ad9c1abc5852f87f1784dc47731f0a59f3597a5dd13c2	2026-05-16 10:42:35.684412	2026-05-23 10:42:35.682	\N	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36	t
5	1	44c0afb515e2b7d2a69916d2bc42d4b15bdaea9b08034ab524c4817779843f9c	2026-05-16 10:59:06.869673	2026-05-23 10:59:06.869	\N	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36	t
6	1	fdf87c7c432e36b64de609b792fc9573a3a6cd78f0e3bdcbd69bf29527d2c1e8	2026-05-18 12:05:25.342188	2026-05-25 12:05:25.34	\N	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36	t
7	4	e5b3a9666e18e476ec35015091b8dede009bb8017a2319ce5abec36c16145b2b	2026-05-18 12:16:09.329404	2026-05-25 12:16:09.328	\N	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36	t
8	1	5fc653e3a79e025a832172556417bfa6e2284ec6c35b09529cf559d5e047af99	2026-05-18 12:22:34.559196	2026-05-25 12:22:34.558	\N	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36	t
9	4	f57b633923b5b81bddfaecf2c93b3b8e5ef038f1636160363f5847f4e0a5eca4	2026-05-18 12:48:00.445763	2026-05-25 12:48:00.445	\N	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36	t
10	1	a3db59bb877f8be31d1b31dae1d809aa5cba594f0f65e6681aa04aeeb7b86392	2026-05-18 12:48:42.23211	2026-05-25 12:48:42.23	\N	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36	t
11	1	3d4e9ce42721494ce54c1fe1d4128f605152034c4491caffedcd50f2937447e2	2026-05-18 14:07:44.195973	2026-05-25 14:07:44.193	\N	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36	t
12	1	3a5dc146e562b55c065670b71e74d5d4ef1bc2e2900691af302f7603f373893d	2026-05-18 14:11:24.386886	2026-05-25 14:11:24.386	\N	::1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36	t
\.


--
-- Data for Name: utilisateur_locations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.utilisateur_locations (id, utilisateur_id, location_id, est_defaut, created_at) FROM stdin;
\.


--
-- Data for Name: utilisateurs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.utilisateurs (id, username, email, password_hash, nom_complet, actif, dernier_login, created_at, updated_at, must_change_password, role_id, customiser_permissions) FROM stdin;
2	manager	manager@magasin.local	$2b$10$i2yk4CcSNJ4qp4T6r2AXAe8U0YsQC8B/cRvskvTnlcmy5Ub51xN4K	Manager Magasin	t	\N	2026-05-14 17:07:53.350258	2026-05-18 12:04:26.02143	f	2	f
3	caissier	caissier@magasin.local	$2b$10$Kq8127.pFIsAFt6mispYXOPJ.R4Gca1xeMp8g4ljHQwqwG6u7bNhe	Caissier Magasin	t	\N	2026-05-14 17:07:53.350258	2026-05-18 12:04:26.02143	f	3	f
4	lahaf	lahaf@email.com	$2b$10$PHT/rEEU8qLUkhZotnSfo.hZrenfkVc9NMVuBfcNIb4LfIhbXt1gK	lahaf	t	2026-05-18 12:48:00.443341	2026-05-18 12:15:54.611466	2026-05-18 12:48:00.443341	f	4	t
1	admin	admin@magasin.local	$2b$10$PSl1350gYU06U/pfpparR.mF4fZDKIERyeO4bPeRXAFUMTv1NPl/G	Administrateur Système	t	2026-05-18 14:11:24.379374	2026-05-14 17:07:53.350258	2026-05-18 14:11:24.379374	f	1	f
\.


--
-- Name: acompte_applications_fournisseur_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.acompte_applications_fournisseur_id_seq', 1, false);


--
-- Name: acompte_applications_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.acompte_applications_id_seq', 1, false);


--
-- Name: acomptes_clients_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.acomptes_clients_id_seq', 1, false);


--
-- Name: acomptes_fournisseur_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.acomptes_fournisseur_id_seq', 1, false);


--
-- Name: allocation_audit_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.allocation_audit_id_seq', 1, false);


--
-- Name: audit_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.audit_log_id_seq', 1, true);


--
-- Name: avoir_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.avoir_seq', 1, false);


--
-- Name: barcode_scans_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.barcode_scans_id_seq', 1, false);


--
-- Name: bl_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.bl_seq', 8, true);


--
-- Name: bon_livraison_lignes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.bon_livraison_lignes_id_seq', 1, false);


--
-- Name: bons_livraison_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.bons_livraison_id_seq', 1, false);


--
-- Name: caisses_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.caisses_id_seq', 1, false);


--
-- Name: categories_depenses_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.categories_depenses_id_seq', 20, true);


--
-- Name: commande_lignes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.commande_lignes_id_seq', 1, false);


--
-- Name: commande_numero_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.commande_numero_seq', 14, true);


--
-- Name: commandes_fournisseur_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.commandes_fournisseur_id_seq', 1, false);


--
-- Name: compensations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.compensations_id_seq', 1, false);


--
-- Name: compte_client_lignes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.compte_client_lignes_id_seq', 1, false);


--
-- Name: compte_fournisseur_lignes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.compte_fournisseur_lignes_id_seq', 1, false);


--
-- Name: demande_reappro_numero_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.demande_reappro_numero_seq', 6, true);


--
-- Name: demandes_reapprovisionnement_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.demandes_reapprovisionnement_history_id_seq', 1, false);


--
-- Name: demandes_reapprovisionnement_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.demandes_reapprovisionnement_id_seq', 1, false);


--
-- Name: demandes_reapprovisionnement_lignes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.demandes_reapprovisionnement_lignes_id_seq', 1, false);


--
-- Name: depense_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.depense_seq', 3, true);


--
-- Name: depenses_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.depenses_id_seq', 1, false);


--
-- Name: devis_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.devis_id_seq', 1, false);


--
-- Name: devis_lignes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.devis_lignes_id_seq', 1, false);


--
-- Name: devis_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.devis_seq', 11, true);


--
-- Name: document_lignes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.document_lignes_id_seq', 1, false);


--
-- Name: ecritures_comptables_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.ecritures_comptables_id_seq', 1, false);


--
-- Name: employes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.employes_id_seq', 1, false);


--
-- Name: facture_avoir_lignes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.facture_avoir_lignes_id_seq', 1, false);


--
-- Name: facture_fournisseur_lignes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.facture_fournisseur_lignes_id_seq', 1, false);


--
-- Name: facture_fournisseur_numero_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.facture_fournisseur_numero_seq', 7, true);


--
-- Name: facture_numero_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.facture_numero_seq', 227, true);


--
-- Name: factures_avoir_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.factures_avoir_id_seq', 1, false);


--
-- Name: factures_fournisseur_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.factures_fournisseur_id_seq', 1, false);


--
-- Name: factures_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.factures_id_seq', 1, false);


--
-- Name: internal_request_numero_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.internal_request_numero_seq', 7, true);


--
-- Name: internal_stock_request_lignes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.internal_stock_request_lignes_id_seq', 1, false);


--
-- Name: internal_stock_requests_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.internal_stock_requests_id_seq', 1, false);


--
-- Name: lots_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.lots_id_seq', 1, false);


--
-- Name: magasins_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.magasins_id_seq', 2, true);


--
-- Name: mouvements_caisse_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.mouvements_caisse_id_seq', 1, false);


--
-- Name: mouvements_stock_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.mouvements_stock_id_seq', 1, false);


--
-- Name: numeros_serie_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.numeros_serie_id_seq', 1, false);


--
-- Name: paiements_fournisseur_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.paiements_fournisseur_id_seq', 1, false);


--
-- Name: paiements_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.paiements_id_seq', 1, false);


--
-- Name: periodes_comptables_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.periodes_comptables_id_seq', 1, false);


--
-- Name: permissions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.permissions_id_seq', 60, true);


--
-- Name: plan_comptable_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.plan_comptable_id_seq', 84, true);


--
-- Name: pos_cart_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.pos_cart_items_id_seq', 1, false);


--
-- Name: pos_sessions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.pos_sessions_id_seq', 1, false);


--
-- Name: produits_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.produits_id_seq', 1, false);


--
-- Name: reception_lignes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.reception_lignes_id_seq', 1, false);


--
-- Name: reception_numero_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.reception_numero_seq', 6, true);


--
-- Name: receptions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.receptions_id_seq', 1, false);


--
-- Name: retour_lignes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.retour_lignes_id_seq', 1, false);


--
-- Name: retours_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.retours_id_seq', 1, false);


--
-- Name: roles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.roles_id_seq', 6, true);


--
-- Name: sessions_caisse_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.sessions_caisse_id_seq', 1, false);


--
-- Name: sessions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.sessions_id_seq', 1, false);


--
-- Name: shifts_employes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.shifts_employes_id_seq', 1, false);


--
-- Name: stock_locations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.stock_locations_id_seq', 2, true);


--
-- Name: stock_par_location_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.stock_par_location_id_seq', 1, false);


--
-- Name: stock_transfer_lignes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.stock_transfer_lignes_id_seq', 1, false);


--
-- Name: stock_transfers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.stock_transfers_id_seq', 1, false);


--
-- Name: taux_tva_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.taux_tva_id_seq', 6, true);


--
-- Name: three_way_match_details_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.three_way_match_details_id_seq', 1, false);


--
-- Name: three_way_matches_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.three_way_matches_id_seq', 1, false);


--
-- Name: tiers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.tiers_id_seq', 1, false);


--
-- Name: transfer_numero_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.transfer_numero_seq', 12, true);


--
-- Name: transfert_caisse_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.transfert_caisse_seq', 1, false);


--
-- Name: transferts_caisse_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.transferts_caisse_id_seq', 1, false);


--
-- Name: user_location_roles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.user_location_roles_id_seq', 1, true);


--
-- Name: user_sessions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.user_sessions_id_seq', 12, true);


--
-- Name: utilisateur_locations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.utilisateur_locations_id_seq', 1, false);


--
-- Name: utilisateurs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.utilisateurs_id_seq', 4, true);


--
-- Name: acompte_applications_fournisseur acompte_applications_fournisseur_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acompte_applications_fournisseur
    ADD CONSTRAINT acompte_applications_fournisseur_pkey PRIMARY KEY (id);


--
-- Name: acompte_applications acompte_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acompte_applications
    ADD CONSTRAINT acompte_applications_pkey PRIMARY KEY (id);


--
-- Name: acomptes_clients acomptes_clients_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acomptes_clients
    ADD CONSTRAINT acomptes_clients_pkey PRIMARY KEY (id);


--
-- Name: acomptes_fournisseur acomptes_fournisseur_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acomptes_fournisseur
    ADD CONSTRAINT acomptes_fournisseur_pkey PRIMARY KEY (id);


--
-- Name: allocation_audit allocation_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_audit
    ADD CONSTRAINT allocation_audit_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: barcode_scans barcode_scans_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.barcode_scans
    ADD CONSTRAINT barcode_scans_pkey PRIMARY KEY (id);


--
-- Name: bon_livraison_lignes bon_livraison_lignes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bon_livraison_lignes
    ADD CONSTRAINT bon_livraison_lignes_pkey PRIMARY KEY (id);


--
-- Name: bons_livraison bons_livraison_numero_bl_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bons_livraison
    ADD CONSTRAINT bons_livraison_numero_bl_key UNIQUE (numero_bl);


--
-- Name: bons_livraison bons_livraison_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bons_livraison
    ADD CONSTRAINT bons_livraison_pkey PRIMARY KEY (id);


--
-- Name: caisses caisses_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.caisses
    ADD CONSTRAINT caisses_code_key UNIQUE (code);


--
-- Name: caisses caisses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.caisses
    ADD CONSTRAINT caisses_pkey PRIMARY KEY (id);


--
-- Name: categories_depenses categories_depenses_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories_depenses
    ADD CONSTRAINT categories_depenses_code_key UNIQUE (code);


--
-- Name: categories_depenses categories_depenses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories_depenses
    ADD CONSTRAINT categories_depenses_pkey PRIMARY KEY (id);


--
-- Name: paiements chk_paiement_acompte_no_session; Type: CHECK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE public.paiements
    ADD CONSTRAINT chk_paiement_acompte_no_session CHECK ((((source)::text <> 'acompte_application'::text) OR (session_caisse_id IS NULL))) NOT VALID;


--
-- Name: paiements chk_paiement_espece_session; Type: CHECK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE public.paiements
    ADD CONSTRAINT chk_paiement_espece_session CHECK ((((methode_paiement)::text <> 'espece'::text) OR ((source)::text = 'acompte_application'::text) OR (session_caisse_id IS NOT NULL))) NOT VALID;


--
-- Name: commande_lignes commande_lignes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.commande_lignes
    ADD CONSTRAINT commande_lignes_pkey PRIMARY KEY (id);


--
-- Name: commandes_fournisseur commandes_fournisseur_numero_commande_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.commandes_fournisseur
    ADD CONSTRAINT commandes_fournisseur_numero_commande_key UNIQUE (numero_commande);


--
-- Name: commandes_fournisseur commandes_fournisseur_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.commandes_fournisseur
    ADD CONSTRAINT commandes_fournisseur_pkey PRIMARY KEY (id);


--
-- Name: compensations compensations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.compensations
    ADD CONSTRAINT compensations_pkey PRIMARY KEY (id);


--
-- Name: compte_client_lignes compte_client_lignes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.compte_client_lignes
    ADD CONSTRAINT compte_client_lignes_pkey PRIMARY KEY (id);


--
-- Name: compte_fournisseur_lignes compte_fournisseur_lignes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.compte_fournisseur_lignes
    ADD CONSTRAINT compte_fournisseur_lignes_pkey PRIMARY KEY (id);


--
-- Name: demandes_reapprovisionnement_history demandes_reapprovisionnement_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.demandes_reapprovisionnement_history
    ADD CONSTRAINT demandes_reapprovisionnement_history_pkey PRIMARY KEY (id);


--
-- Name: demandes_reapprovisionnement_lignes demandes_reapprovisionnement_lignes_demande_id_produit_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.demandes_reapprovisionnement_lignes
    ADD CONSTRAINT demandes_reapprovisionnement_lignes_demande_id_produit_id_key UNIQUE (demande_id, produit_id);


--
-- Name: demandes_reapprovisionnement_lignes demandes_reapprovisionnement_lignes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.demandes_reapprovisionnement_lignes
    ADD CONSTRAINT demandes_reapprovisionnement_lignes_pkey PRIMARY KEY (id);


--
-- Name: demandes_reapprovisionnement demandes_reapprovisionnement_numero_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.demandes_reapprovisionnement
    ADD CONSTRAINT demandes_reapprovisionnement_numero_key UNIQUE (numero);


--
-- Name: demandes_reapprovisionnement demandes_reapprovisionnement_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.demandes_reapprovisionnement
    ADD CONSTRAINT demandes_reapprovisionnement_pkey PRIMARY KEY (id);


--
-- Name: depenses depenses_numero_depense_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.depenses
    ADD CONSTRAINT depenses_numero_depense_key UNIQUE (numero_depense);


--
-- Name: depenses depenses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.depenses
    ADD CONSTRAINT depenses_pkey PRIMARY KEY (id);


--
-- Name: devis_lignes devis_lignes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.devis_lignes
    ADD CONSTRAINT devis_lignes_pkey PRIMARY KEY (id);


--
-- Name: devis devis_numero_devis_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.devis
    ADD CONSTRAINT devis_numero_devis_key UNIQUE (numero_devis);


--
-- Name: devis devis_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.devis
    ADD CONSTRAINT devis_pkey PRIMARY KEY (id);


--
-- Name: document_lignes document_lignes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.document_lignes
    ADD CONSTRAINT document_lignes_pkey PRIMARY KEY (id);


--
-- Name: ecritures_comptables ecritures_comptables_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ecritures_comptables
    ADD CONSTRAINT ecritures_comptables_pkey PRIMARY KEY (id);


--
-- Name: employes employes_matricule_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employes
    ADD CONSTRAINT employes_matricule_key UNIQUE (matricule);


--
-- Name: employes employes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employes
    ADD CONSTRAINT employes_pkey PRIMARY KEY (id);


--
-- Name: employes employes_utilisateur_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employes
    ADD CONSTRAINT employes_utilisateur_id_key UNIQUE (utilisateur_id);


--
-- Name: facture_avoir_lignes facture_avoir_lignes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.facture_avoir_lignes
    ADD CONSTRAINT facture_avoir_lignes_pkey PRIMARY KEY (id);


--
-- Name: facture_fournisseur_lignes facture_fournisseur_lignes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.facture_fournisseur_lignes
    ADD CONSTRAINT facture_fournisseur_lignes_pkey PRIMARY KEY (id);


--
-- Name: factures_avoir factures_avoir_numero_avoir_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.factures_avoir
    ADD CONSTRAINT factures_avoir_numero_avoir_key UNIQUE (numero_avoir);


--
-- Name: factures_avoir factures_avoir_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.factures_avoir
    ADD CONSTRAINT factures_avoir_pkey PRIMARY KEY (id);


--
-- Name: factures_fournisseur factures_fournisseur_numero_facture_interne_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.factures_fournisseur
    ADD CONSTRAINT factures_fournisseur_numero_facture_interne_key UNIQUE (numero_facture_interne);


--
-- Name: factures_fournisseur factures_fournisseur_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.factures_fournisseur
    ADD CONSTRAINT factures_fournisseur_pkey PRIMARY KEY (id);


--
-- Name: factures_fournisseur factures_fournisseur_tiers_id_numero_facture_fournisseur_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.factures_fournisseur
    ADD CONSTRAINT factures_fournisseur_tiers_id_numero_facture_fournisseur_key UNIQUE (tiers_id, numero_facture_fournisseur);


--
-- Name: factures factures_numero_facture_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.factures
    ADD CONSTRAINT factures_numero_facture_key UNIQUE (numero_facture);


--
-- Name: factures factures_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.factures
    ADD CONSTRAINT factures_pkey PRIMARY KEY (id);


--
-- Name: _deprecated_internal_stock_request_lignes internal_stock_request_lignes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._deprecated_internal_stock_request_lignes
    ADD CONSTRAINT internal_stock_request_lignes_pkey PRIMARY KEY (id);


--
-- Name: _deprecated_internal_stock_request_lignes internal_stock_request_lignes_request_id_produit_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._deprecated_internal_stock_request_lignes
    ADD CONSTRAINT internal_stock_request_lignes_request_id_produit_id_key UNIQUE (request_id, produit_id);


--
-- Name: _deprecated_internal_stock_requests internal_stock_requests_numero_demande_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._deprecated_internal_stock_requests
    ADD CONSTRAINT internal_stock_requests_numero_demande_key UNIQUE (numero_demande);


--
-- Name: _deprecated_internal_stock_requests internal_stock_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._deprecated_internal_stock_requests
    ADD CONSTRAINT internal_stock_requests_pkey PRIMARY KEY (id);


--
-- Name: lots lots_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lots
    ADD CONSTRAINT lots_pkey PRIMARY KEY (id);


--
-- Name: magasins magasins_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.magasins
    ADD CONSTRAINT magasins_code_key UNIQUE (code);


--
-- Name: magasins magasins_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.magasins
    ADD CONSTRAINT magasins_pkey PRIMARY KEY (id);


--
-- Name: mouvements_caisse mouvements_caisse_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mouvements_caisse
    ADD CONSTRAINT mouvements_caisse_pkey PRIMARY KEY (id);


--
-- Name: mouvements_stock mouvements_stock_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mouvements_stock
    ADD CONSTRAINT mouvements_stock_pkey PRIMARY KEY (id);


--
-- Name: numeros_serie numeros_serie_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.numeros_serie
    ADD CONSTRAINT numeros_serie_pkey PRIMARY KEY (id);


--
-- Name: numeros_serie numeros_serie_produit_id_numero_serie_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.numeros_serie
    ADD CONSTRAINT numeros_serie_produit_id_numero_serie_key UNIQUE (produit_id, numero_serie);


--
-- Name: paiements_fournisseur paiements_fournisseur_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.paiements_fournisseur
    ADD CONSTRAINT paiements_fournisseur_pkey PRIMARY KEY (id);


--
-- Name: paiements paiements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.paiements
    ADD CONSTRAINT paiements_pkey PRIMARY KEY (id);


--
-- Name: periodes_comptables periodes_comptables_exercice_periode_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.periodes_comptables
    ADD CONSTRAINT periodes_comptables_exercice_periode_key UNIQUE (exercice, periode);


--
-- Name: periodes_comptables periodes_comptables_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.periodes_comptables
    ADD CONSTRAINT periodes_comptables_pkey PRIMARY KEY (id);


--
-- Name: permissions permissions_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_code_key UNIQUE (code);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: plan_comptable plan_comptable_numero_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.plan_comptable
    ADD CONSTRAINT plan_comptable_numero_key UNIQUE (numero);


--
-- Name: plan_comptable plan_comptable_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.plan_comptable
    ADD CONSTRAINT plan_comptable_pkey PRIMARY KEY (id);


--
-- Name: pos_cart_items pos_cart_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pos_cart_items
    ADD CONSTRAINT pos_cart_items_pkey PRIMARY KEY (id);


--
-- Name: pos_sessions pos_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pos_sessions
    ADD CONSTRAINT pos_sessions_pkey PRIMARY KEY (id);


--
-- Name: produits produits_code_barre_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.produits
    ADD CONSTRAINT produits_code_barre_key UNIQUE (code_barre);


--
-- Name: produits produits_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.produits
    ADD CONSTRAINT produits_pkey PRIMARY KEY (id);


--
-- Name: produits produits_reference_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.produits
    ADD CONSTRAINT produits_reference_key UNIQUE (reference);


--
-- Name: reception_lignes reception_lignes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reception_lignes
    ADD CONSTRAINT reception_lignes_pkey PRIMARY KEY (id);


--
-- Name: receptions receptions_numero_reception_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.receptions
    ADD CONSTRAINT receptions_numero_reception_key UNIQUE (numero_reception);


--
-- Name: receptions receptions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.receptions
    ADD CONSTRAINT receptions_pkey PRIMARY KEY (id);


--
-- Name: retour_lignes retour_lignes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.retour_lignes
    ADD CONSTRAINT retour_lignes_pkey PRIMARY KEY (id);


--
-- Name: retours retours_numero_retour_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.retours
    ADD CONSTRAINT retours_numero_retour_key UNIQUE (numero_retour);


--
-- Name: retours retours_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.retours
    ADD CONSTRAINT retours_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id);


--
-- Name: roles roles_nom_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_nom_key UNIQUE (nom);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: sessions_caisse sessions_caisse_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sessions_caisse
    ADD CONSTRAINT sessions_caisse_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: shifts_employes shifts_employes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shifts_employes
    ADD CONSTRAINT shifts_employes_pkey PRIMARY KEY (id);


--
-- Name: stock_locations stock_locations_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_locations
    ADD CONSTRAINT stock_locations_code_key UNIQUE (code);


--
-- Name: stock_locations stock_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_locations
    ADD CONSTRAINT stock_locations_pkey PRIMARY KEY (id);


--
-- Name: stock_par_location stock_par_location_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_par_location
    ADD CONSTRAINT stock_par_location_pkey PRIMARY KEY (id);


--
-- Name: stock_par_location stock_par_location_produit_id_location_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_par_location
    ADD CONSTRAINT stock_par_location_produit_id_location_id_key UNIQUE (produit_id, location_id);


--
-- Name: stock_transfer_lignes stock_transfer_lignes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_transfer_lignes
    ADD CONSTRAINT stock_transfer_lignes_pkey PRIMARY KEY (id);


--
-- Name: stock_transfer_lignes stock_transfer_lignes_transfer_id_produit_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_transfer_lignes
    ADD CONSTRAINT stock_transfer_lignes_transfer_id_produit_id_key UNIQUE (transfer_id, produit_id);


--
-- Name: stock_transfers stock_transfers_numero_transfer_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_numero_transfer_key UNIQUE (numero_transfer);


--
-- Name: stock_transfers stock_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_pkey PRIMARY KEY (id);


--
-- Name: taux_tva taux_tva_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.taux_tva
    ADD CONSTRAINT taux_tva_code_key UNIQUE (code);


--
-- Name: taux_tva taux_tva_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.taux_tva
    ADD CONSTRAINT taux_tva_pkey PRIMARY KEY (id);


--
-- Name: _deprecated_three_way_match_details_2026_05 three_way_match_details_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._deprecated_three_way_match_details_2026_05
    ADD CONSTRAINT three_way_match_details_pkey PRIMARY KEY (id);


--
-- Name: _deprecated_three_way_matches_2026_05 three_way_matches_commande_id_reception_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._deprecated_three_way_matches_2026_05
    ADD CONSTRAINT three_way_matches_commande_id_reception_id_key UNIQUE (commande_id, reception_id);


--
-- Name: _deprecated_three_way_matches_2026_05 three_way_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._deprecated_three_way_matches_2026_05
    ADD CONSTRAINT three_way_matches_pkey PRIMARY KEY (id);


--
-- Name: tiers tiers_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tiers
    ADD CONSTRAINT tiers_code_key UNIQUE (code);


--
-- Name: tiers tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tiers
    ADD CONSTRAINT tiers_pkey PRIMARY KEY (id);


--
-- Name: transferts_caisse transferts_caisse_numero_transfert_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transferts_caisse
    ADD CONSTRAINT transferts_caisse_numero_transfert_key UNIQUE (numero_transfert);


--
-- Name: transferts_caisse transferts_caisse_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transferts_caisse
    ADD CONSTRAINT transferts_caisse_pkey PRIMARY KEY (id);


--
-- Name: user_location_roles user_location_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_location_roles
    ADD CONSTRAINT user_location_roles_pkey PRIMARY KEY (id);


--
-- Name: user_location_roles user_location_roles_utilisateur_id_location_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_location_roles
    ADD CONSTRAINT user_location_roles_utilisateur_id_location_id_key UNIQUE (utilisateur_id, location_id);


--
-- Name: user_permissions user_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_pkey PRIMARY KEY (utilisateur_id, permission_id);


--
-- Name: user_sessions user_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);


--
-- Name: utilisateur_locations utilisateur_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.utilisateur_locations
    ADD CONSTRAINT utilisateur_locations_pkey PRIMARY KEY (id);


--
-- Name: utilisateur_locations utilisateur_locations_utilisateur_id_location_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.utilisateur_locations
    ADD CONSTRAINT utilisateur_locations_utilisateur_id_location_id_key UNIQUE (utilisateur_id, location_id);


--
-- Name: utilisateurs utilisateurs_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.utilisateurs
    ADD CONSTRAINT utilisateurs_email_key UNIQUE (email);


--
-- Name: utilisateurs utilisateurs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.utilisateurs
    ADD CONSTRAINT utilisateurs_pkey PRIMARY KEY (id);


--
-- Name: utilisateurs utilisateurs_username_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.utilisateurs
    ADD CONSTRAINT utilisateurs_username_key UNIQUE (username);


--
-- Name: idx_3wm_commande; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_3wm_commande ON public._deprecated_three_way_matches_2026_05 USING btree (commande_id);


--
-- Name: idx_3wm_facture; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_3wm_facture ON public._deprecated_three_way_matches_2026_05 USING btree (facture_fournisseur_id);


--
-- Name: idx_3wm_reception; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_3wm_reception ON public._deprecated_three_way_matches_2026_05 USING btree (reception_id);


--
-- Name: idx_3wm_statut; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_3wm_statut ON public._deprecated_three_way_matches_2026_05 USING btree (statut);


--
-- Name: idx_acompte_app_acompte; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_acompte_app_acompte ON public.acompte_applications USING btree (acompte_id);


--
-- Name: idx_acompte_app_facture; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_acompte_app_facture ON public.acompte_applications USING btree (facture_id);


--
-- Name: idx_acompte_app_fourn_acompte; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_acompte_app_fourn_acompte ON public.acompte_applications_fournisseur USING btree (acompte_id);


--
-- Name: idx_acompte_app_fourn_facture; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_acompte_app_fourn_facture ON public.acompte_applications_fournisseur USING btree (facture_id);


--
-- Name: idx_acompte_app_fourn_paiement; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_acompte_app_fourn_paiement ON public.acompte_applications_fournisseur USING btree (paiement_id);


--
-- Name: idx_acompte_app_paiement; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_acompte_app_paiement ON public.acompte_applications USING btree (paiement_id);


--
-- Name: idx_acomptes_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_acomptes_date ON public.acomptes_clients USING btree (date_acompte);


--
-- Name: idx_acomptes_fourn_mouvement; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_acomptes_fourn_mouvement ON public.acomptes_fournisseur USING btree (mouvement_caisse_id) WHERE (mouvement_caisse_id IS NOT NULL);


--
-- Name: idx_acomptes_fourn_restant; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_acomptes_fourn_restant ON public.acomptes_fournisseur USING btree (tiers_id, statut) WHERE ((deleted_at IS NULL) AND (montant_restant > (0)::numeric));


--
-- Name: idx_acomptes_fourn_session; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_acomptes_fourn_session ON public.acomptes_fournisseur USING btree (session_caisse_id) WHERE (session_caisse_id IS NOT NULL);


--
-- Name: idx_acomptes_fourn_statut; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_acomptes_fourn_statut ON public.acomptes_fournisseur USING btree (statut);


--
-- Name: idx_acomptes_fourn_tiers; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_acomptes_fourn_tiers ON public.acomptes_fournisseur USING btree (tiers_id);


--
-- Name: idx_acomptes_magasin; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_acomptes_magasin ON public.acomptes_clients USING btree (magasin_id);


--
-- Name: idx_acomptes_restant; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_acomptes_restant ON public.acomptes_clients USING btree (tiers_id, statut) WHERE ((deleted_at IS NULL) AND (montant_restant > (0)::numeric));


--
-- Name: idx_acomptes_statut; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_acomptes_statut ON public.acomptes_clients USING btree (statut);


--
-- Name: idx_acomptes_tiers; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_acomptes_tiers ON public.acomptes_clients USING btree (tiers_id);


--
-- Name: idx_alloc_audit_tiers; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_alloc_audit_tiers ON public.allocation_audit USING btree (tiers_id, created_at);


--
-- Name: idx_audit_action; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_audit_action ON public.audit_log USING btree (action);


--
-- Name: idx_audit_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_audit_date ON public.audit_log USING btree (created_at);


--
-- Name: idx_audit_table; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_audit_table ON public.audit_log USING btree (table_name);


--
-- Name: idx_audit_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_audit_user ON public.audit_log USING btree (utilisateur_id);


--
-- Name: idx_avoir_deleted; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_avoir_deleted ON public.factures_avoir USING btree (deleted_at);


--
-- Name: idx_avoir_facture; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_avoir_facture ON public.factures_avoir USING btree (facture_origine_id);


--
-- Name: idx_avoir_lignes_avoir; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_avoir_lignes_avoir ON public.facture_avoir_lignes USING btree (avoir_id);


--
-- Name: idx_avoir_tiers; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_avoir_tiers ON public.factures_avoir USING btree (tiers_id);


--
-- Name: idx_barcode_scans_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_barcode_scans_code ON public.barcode_scans USING btree (code_barre);


--
-- Name: idx_barcode_scans_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_barcode_scans_date ON public.barcode_scans USING btree (date_scan);


--
-- Name: idx_barcode_scans_produit; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_barcode_scans_produit ON public.barcode_scans USING btree (produit_id);


--
-- Name: idx_bl_deleted; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bl_deleted ON public.bons_livraison USING btree (deleted_at);


--
-- Name: idx_bl_lignes_bl; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bl_lignes_bl ON public.bon_livraison_lignes USING btree (bl_id);


--
-- Name: idx_bl_statut; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bl_statut ON public.bons_livraison USING btree (statut);


--
-- Name: idx_bl_tiers; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bl_tiers ON public.bons_livraison USING btree (tiers_id);


--
-- Name: idx_caisses_location; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_caisses_location ON public.caisses USING btree (location_id);


--
-- Name: idx_caisses_parent; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_caisses_parent ON public.caisses USING btree (caisse_parent_id);


--
-- Name: idx_caisses_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_caisses_type ON public.caisses USING btree (type);


--
-- Name: idx_ccl_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ccl_date ON public.compte_client_lignes USING btree (date_operation);


--
-- Name: idx_ccl_document; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ccl_document ON public.compte_client_lignes USING btree (document_id, type_operation);


--
-- Name: idx_ccl_tiers; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ccl_tiers ON public.compte_client_lignes USING btree (tiers_id);


--
-- Name: idx_ccl_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ccl_type ON public.compte_client_lignes USING btree (type_operation);


--
-- Name: idx_cfl_tiers; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cfl_tiers ON public.compte_fournisseur_lignes USING btree (tiers_id);


--
-- Name: idx_cfl_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cfl_type ON public.compte_fournisseur_lignes USING btree (type_operation);


--
-- Name: idx_commande_deleted; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_commande_deleted ON public.commandes_fournisseur USING btree (deleted_at);


--
-- Name: idx_commande_lignes_commande; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_commande_lignes_commande ON public.commande_lignes USING btree (commande_id);


--
-- Name: idx_commande_statut; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_commande_statut ON public.commandes_fournisseur USING btree (statut);


--
-- Name: idx_commande_tiers; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_commande_tiers ON public.commandes_fournisseur USING btree (tiers_id);


--
-- Name: idx_comp_statut; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_comp_statut ON public.compensations USING btree (statut);


--
-- Name: idx_comp_tiers; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_comp_tiers ON public.compensations USING btree (tiers_id);


--
-- Name: idx_demandes_created_by; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_demandes_created_by ON public.demandes_reapprovisionnement USING btree (created_by_user_id);


--
-- Name: idx_demandes_date_creation; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_demandes_date_creation ON public.demandes_reapprovisionnement USING btree (date_creation DESC);


--
-- Name: idx_demandes_depot; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_demandes_depot ON public.demandes_reapprovisionnement USING btree (depot_id);


--
-- Name: idx_demandes_depot_statut; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_demandes_depot_statut ON public.demandes_reapprovisionnement USING btree (depot_id, statut);


--
-- Name: idx_demandes_history_demande; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_demandes_history_demande ON public.demandes_reapprovisionnement_history USING btree (demande_id);


--
-- Name: idx_demandes_history_timestamp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_demandes_history_timestamp ON public.demandes_reapprovisionnement_history USING btree ("timestamp" DESC);


--
-- Name: idx_demandes_lignes_demande; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_demandes_lignes_demande ON public.demandes_reapprovisionnement_lignes USING btree (demande_id);


--
-- Name: idx_demandes_lignes_produit; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_demandes_lignes_produit ON public.demandes_reapprovisionnement_lignes USING btree (produit_id);


--
-- Name: idx_demandes_magasin; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_demandes_magasin ON public.demandes_reapprovisionnement USING btree (magasin_id);


--
-- Name: idx_demandes_magasin_statut; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_demandes_magasin_statut ON public.demandes_reapprovisionnement USING btree (magasin_id, statut);


--
-- Name: idx_demandes_statut; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_demandes_statut ON public.demandes_reapprovisionnement USING btree (statut);


--
-- Name: idx_demandes_transfert; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_demandes_transfert ON public.demandes_reapprovisionnement USING btree (transfert_id);


--
-- Name: idx_depenses_categorie; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_depenses_categorie ON public.depenses USING btree (categorie_id);


--
-- Name: idx_depenses_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_depenses_date ON public.depenses USING btree (date_depense);


--
-- Name: idx_depenses_deleted_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_depenses_deleted_at ON public.depenses USING btree (deleted_at);


--
-- Name: idx_depenses_fournisseur; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_depenses_fournisseur ON public.depenses USING btree (tiers_id);


--
-- Name: idx_depenses_location; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_depenses_location ON public.depenses USING btree (location_id);


--
-- Name: idx_depenses_magasin; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_depenses_magasin ON public.depenses USING btree (magasin_id);


--
-- Name: idx_depenses_methode; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_depenses_methode ON public.depenses USING btree (methode_paiement);


--
-- Name: idx_depenses_mouvement; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_depenses_mouvement ON public.depenses USING btree (mouvement_caisse_id);


--
-- Name: idx_depenses_session; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_depenses_session ON public.depenses USING btree (session_caisse_id);


--
-- Name: idx_devis_deleted; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_devis_deleted ON public.devis USING btree (deleted_at);


--
-- Name: idx_devis_lignes_devis; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_devis_lignes_devis ON public.devis_lignes USING btree (devis_id);


--
-- Name: idx_devis_statut; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_devis_statut ON public.devis USING btree (statut);


--
-- Name: idx_devis_tiers; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_devis_tiers ON public.devis USING btree (tiers_id);


--
-- Name: idx_document_lignes_lookup; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_document_lignes_lookup ON public.document_lignes USING btree (document_type, document_id);


--
-- Name: idx_document_lignes_produit; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_document_lignes_produit ON public.document_lignes USING btree (produit_id);


--
-- Name: idx_ecriture_compte; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ecriture_compte ON public.ecritures_comptables USING btree (compte_id);


--
-- Name: idx_ecriture_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ecriture_date ON public.ecritures_comptables USING btree (date_ecriture);


--
-- Name: idx_ecriture_journal; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ecriture_journal ON public.ecritures_comptables USING btree (journal);


--
-- Name: idx_ecriture_piece; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ecriture_piece ON public.ecritures_comptables USING btree (piece_type, piece_id);


--
-- Name: idx_employes_actif; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employes_actif ON public.employes USING btree (actif);


--
-- Name: idx_employes_matricule; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employes_matricule ON public.employes USING btree (matricule);


--
-- Name: idx_employes_utilisateur; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employes_utilisateur ON public.employes USING btree (utilisateur_id);


--
-- Name: idx_facture_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_facture_date ON public.factures USING btree (date_facture);


--
-- Name: idx_facture_deleted; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_facture_deleted ON public.factures USING btree (deleted_at);


--
-- Name: idx_facture_echeance; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_facture_echeance ON public.factures USING btree (date_echeance);


--
-- Name: idx_facture_statut; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_facture_statut ON public.factures USING btree (statut);


--
-- Name: idx_facture_tiers; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_facture_tiers ON public.factures USING btree (tiers_id);


--
-- Name: idx_factures_avoir_appliquee; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_factures_avoir_appliquee ON public.factures_avoir USING btree (facture_appliquee_id);


--
-- Name: idx_factures_avoir_deleted_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_factures_avoir_deleted_at ON public.factures_avoir USING btree (deleted_at);


--
-- Name: idx_factures_bl_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_factures_bl_id ON public.factures USING btree (bl_id);


--
-- Name: idx_factures_devis_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_factures_devis_id ON public.factures USING btree (devis_id);


--
-- Name: idx_factures_magasin; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_factures_magasin ON public.factures USING btree (magasin_id);


--
-- Name: idx_factures_tiers_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_factures_tiers_date ON public.factures USING btree (tiers_id, date_facture, id) WHERE (deleted_at IS NULL);


--
-- Name: idx_ff_echeance; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ff_echeance ON public.factures_fournisseur USING btree (date_echeance);


--
-- Name: idx_ff_statut; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ff_statut ON public.factures_fournisseur USING btree (statut);


--
-- Name: idx_ff_tiers; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ff_tiers ON public.factures_fournisseur USING btree (tiers_id);


--
-- Name: idx_internal_request_lignes_produit; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_internal_request_lignes_produit ON public._deprecated_internal_stock_request_lignes USING btree (produit_id);


--
-- Name: idx_internal_request_lignes_request; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_internal_request_lignes_request ON public._deprecated_internal_stock_request_lignes USING btree (request_id);


--
-- Name: idx_internal_requests_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_internal_requests_created_at ON public._deprecated_internal_stock_requests USING btree (created_at DESC);


--
-- Name: idx_internal_requests_depot; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_internal_requests_depot ON public._deprecated_internal_stock_requests USING btree (depot_id);


--
-- Name: idx_internal_requests_magasin; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_internal_requests_magasin ON public._deprecated_internal_stock_requests USING btree (magasin_id);


--
-- Name: idx_internal_requests_statut; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_internal_requests_statut ON public._deprecated_internal_stock_requests USING btree (statut);


--
-- Name: idx_lots_expiration; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_lots_expiration ON public.lots USING btree (date_expiration);


--
-- Name: idx_lots_fournisseur; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_lots_fournisseur ON public.lots USING btree (fournisseur_id);


--
-- Name: idx_lots_numero; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_lots_numero ON public.lots USING btree (numero_lot);


--
-- Name: idx_lots_produit; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_lots_produit ON public.lots USING btree (produit_id);


--
-- Name: idx_lots_statut; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_lots_statut ON public.lots USING btree (statut);


--
-- Name: idx_magasins_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_magasins_code ON public.magasins USING btree (code);


--
-- Name: idx_magasins_location; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_magasins_location ON public.magasins USING btree (location_id);


--
-- Name: idx_mouvement_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mouvement_date ON public.mouvements_stock USING btree (date_mouvement);


--
-- Name: idx_mouvement_produit; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mouvement_produit ON public.mouvements_stock USING btree (produit_id);


--
-- Name: idx_mouvement_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mouvement_type ON public.mouvements_stock USING btree (type_mouvement);


--
-- Name: idx_mouvements_categorie; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mouvements_categorie ON public.mouvements_caisse USING btree (categorie);


--
-- Name: idx_mouvements_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mouvements_date ON public.mouvements_caisse USING btree (date_mouvement);


--
-- Name: idx_mouvements_location; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mouvements_location ON public.mouvements_stock USING btree (location_id);


--
-- Name: idx_mouvements_magasin_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mouvements_magasin_date ON public.mouvements_caisse USING btree (magasin_id, date_mouvement);


--
-- Name: idx_mouvements_reference; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mouvements_reference ON public.mouvements_caisse USING btree (reference_type, reference_id);


--
-- Name: idx_mouvements_session_caisse; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mouvements_session_caisse ON public.mouvements_caisse USING btree (session_caisse_id);


--
-- Name: idx_mouvements_session_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mouvements_session_date ON public.mouvements_caisse USING btree (session_caisse_id, date_mouvement);


--
-- Name: idx_mouvements_stock_lot; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mouvements_stock_lot ON public.mouvements_stock USING btree (lot_id);


--
-- Name: idx_mouvements_stock_produit_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mouvements_stock_produit_date ON public.mouvements_stock USING btree (produit_id, date_mouvement);


--
-- Name: idx_mouvements_stock_serial; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mouvements_stock_serial ON public.mouvements_stock USING btree (numero_serie_id);


--
-- Name: idx_mouvements_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mouvements_type ON public.mouvements_caisse USING btree (type);


--
-- Name: idx_numeros_serie_client; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_numeros_serie_client ON public.numeros_serie USING btree (client_id);


--
-- Name: idx_numeros_serie_facture; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_numeros_serie_facture ON public.numeros_serie USING btree (facture_id);


--
-- Name: idx_numeros_serie_garantie; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_numeros_serie_garantie ON public.numeros_serie USING btree (garantie_jusqu);


--
-- Name: idx_numeros_serie_produit; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_numeros_serie_produit ON public.numeros_serie USING btree (produit_id);


--
-- Name: idx_numeros_serie_statut; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_numeros_serie_statut ON public.numeros_serie USING btree (statut);


--
-- Name: idx_numeros_serie_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_numeros_serie_unique ON public.numeros_serie USING btree (produit_id, numero_serie);


--
-- Name: idx_paiement_ff; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_paiement_ff ON public.paiements_fournisseur USING btree (facture_id);


--
-- Name: idx_paiements_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_paiements_date ON public.paiements USING btree (date_paiement);


--
-- Name: idx_paiements_date_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_paiements_date_id ON public.paiements USING btree (date_paiement, id);


--
-- Name: idx_paiements_facture; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_paiements_facture ON public.paiements USING btree (facture_id);


--
-- Name: idx_paiements_fourn_source; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_paiements_fourn_source ON public.paiements_fournisseur USING btree (source);


--
-- Name: idx_paiements_fournisseur_magasin; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_paiements_fournisseur_magasin ON public.paiements_fournisseur USING btree (magasin_id);


--
-- Name: idx_paiements_magasin; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_paiements_magasin ON public.paiements USING btree (magasin_id);


--
-- Name: idx_paiements_session; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_paiements_session ON public.paiements USING btree (session_caisse_id);


--
-- Name: idx_paiements_source; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_paiements_source ON public.paiements USING btree (source);


--
-- Name: idx_pos_cart_produit; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pos_cart_produit ON public.pos_cart_items USING btree (produit_id);


--
-- Name: idx_pos_cart_session; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pos_cart_session ON public.pos_cart_items USING btree (session_id);


--
-- Name: idx_pos_sessions_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pos_sessions_date ON public.pos_sessions USING btree (date_ouverture);


--
-- Name: idx_pos_sessions_location; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pos_sessions_location ON public.pos_sessions USING btree (location_id);


--
-- Name: idx_pos_sessions_statut; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pos_sessions_statut ON public.pos_sessions USING btree (statut);


--
-- Name: idx_pos_sessions_utilisateur; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pos_sessions_utilisateur ON public.pos_sessions USING btree (utilisateur_id);


--
-- Name: idx_produit_categorie; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_produit_categorie ON public.produits USING btree (categorie);


--
-- Name: idx_produit_fournisseur; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_produit_fournisseur ON public.produits USING btree (fournisseur_id);


--
-- Name: idx_produit_nom; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_produit_nom ON public.produits USING btree (nom);


--
-- Name: idx_produit_reference; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_produit_reference ON public.produits USING btree (reference);


--
-- Name: idx_produits_categorie_trgm; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_produits_categorie_trgm ON public.produits USING gin (COALESCE(categorie, ''::character varying) public.gin_trgm_ops);


--
-- Name: idx_produits_code_barre; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_produits_code_barre ON public.produits USING btree (code_barre);


--
-- Name: idx_produits_deleted_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_produits_deleted_at ON public.produits USING btree (deleted_at);


--
-- Name: idx_produits_description_trgm; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_produits_description_trgm ON public.produits USING gin (COALESCE(description, ''::text) public.gin_trgm_ops);


--
-- Name: idx_produits_image; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_produits_image ON public.produits USING btree (image_url) WHERE (image_url IS NOT NULL);


--
-- Name: idx_produits_nom_trgm; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_produits_nom_trgm ON public.produits USING gin (nom public.gin_trgm_ops);


--
-- Name: idx_produits_reference_trgm; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_produits_reference_trgm ON public.produits USING gin (reference public.gin_trgm_ops);


--
-- Name: idx_reception_lignes_lot; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_reception_lignes_lot ON public.reception_lignes USING btree (lot_id);


--
-- Name: idx_reception_lignes_reception; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_reception_lignes_reception ON public.reception_lignes USING btree (reception_id);


--
-- Name: idx_receptions_commande; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_receptions_commande ON public.receptions USING btree (commande_id);


--
-- Name: idx_receptions_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_receptions_date ON public.receptions USING btree (date_reception);


--
-- Name: idx_receptions_location; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_receptions_location ON public.receptions USING btree (location_id);


--
-- Name: idx_retour_lignes_retour; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_retour_lignes_retour ON public.retour_lignes USING btree (retour_id);


--
-- Name: idx_retours_statut; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_retours_statut ON public.retours USING btree (statut);


--
-- Name: idx_retours_tiers; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_retours_tiers ON public.retours USING btree (tiers_id);


--
-- Name: idx_sessions_caisse_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sessions_caisse_id ON public.caisses USING btree (caisse_parent_id);


--
-- Name: idx_sessions_cloturee_par; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sessions_cloturee_par ON public.sessions_caisse USING btree (cloturee_par_user_id);


--
-- Name: idx_sessions_date_cloture; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sessions_date_cloture ON public.sessions_caisse USING btree (date_cloture);


--
-- Name: idx_sessions_date_ouverture; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sessions_date_ouverture ON public.sessions_caisse USING btree (date_ouverture);


--
-- Name: idx_sessions_expires; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sessions_expires ON public.sessions USING btree (expires_at);


--
-- Name: idx_sessions_magasin; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sessions_magasin ON public.sessions_caisse USING btree (magasin_id);


--
-- Name: idx_sessions_ouverte_par; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sessions_ouverte_par ON public.sessions_caisse USING btree (ouverte_par_user_id);


--
-- Name: idx_sessions_statut; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sessions_statut ON public.sessions_caisse USING btree (statut);


--
-- Name: idx_sessions_token; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sessions_token ON public.sessions USING btree (token_hash);


--
-- Name: idx_sessions_une_ouverte_par_magasin; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_sessions_une_ouverte_par_magasin ON public.sessions_caisse USING btree (magasin_id) WHERE ((statut)::text = 'ouverte'::text);


--
-- Name: idx_sessions_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sessions_user ON public.sessions USING btree (utilisateur_id);


--
-- Name: idx_shifts_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_shifts_date ON public.shifts_employes USING btree (date_shift);


--
-- Name: idx_shifts_employe; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_shifts_employe ON public.shifts_employes USING btree (employe_id);


--
-- Name: idx_stock_location_location; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_stock_location_location ON public.stock_par_location USING btree (location_id);


--
-- Name: idx_stock_location_produit; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_stock_location_produit ON public.stock_par_location USING btree (produit_id);


--
-- Name: idx_stock_transfer_lignes_demande_ligne; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_stock_transfer_lignes_demande_ligne ON public.stock_transfer_lignes USING btree (demande_ligne_id);


--
-- Name: idx_stock_transfers_demande; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_stock_transfers_demande ON public.stock_transfers USING btree (demande_id);


--
-- Name: idx_taux_tva_actif; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_taux_tva_actif ON public.taux_tva USING btree (actif) WHERE (actif = true);


--
-- Name: idx_tiers_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tiers_code ON public.tiers USING btree (code);


--
-- Name: idx_tiers_deleted_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tiers_deleted_at ON public.tiers USING btree (deleted_at);


--
-- Name: idx_tiers_est_client; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tiers_est_client ON public.tiers USING btree (est_client) WHERE (deleted_at IS NULL);


--
-- Name: idx_tiers_est_fournisseur; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tiers_est_fournisseur ON public.tiers USING btree (est_fournisseur) WHERE (deleted_at IS NULL);


--
-- Name: idx_tiers_nif; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tiers_nif ON public.tiers USING btree (nif) WHERE (nif IS NOT NULL);


--
-- Name: idx_tiers_raison_sociale; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tiers_raison_sociale ON public.tiers USING btree (raison_sociale);


--
-- Name: idx_transfer_destination; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_transfer_destination ON public.stock_transfers USING btree (location_destination_id);


--
-- Name: idx_transfer_source; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_transfer_source ON public.stock_transfers USING btree (location_source_id);


--
-- Name: idx_transfer_statut; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_transfer_statut ON public.stock_transfers USING btree (statut);


--
-- Name: idx_transferts_dest; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_transferts_dest ON public.transferts_caisse USING btree (caisse_dest_id);


--
-- Name: idx_transferts_source; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_transferts_source ON public.transferts_caisse USING btree (caisse_source_id);


--
-- Name: idx_transferts_statut; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_transferts_statut ON public.transferts_caisse USING btree (statut);


--
-- Name: idx_user_location_roles_location; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_location_roles_location ON public.user_location_roles USING btree (location_id);


--
-- Name: idx_user_location_roles_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_location_roles_user ON public.user_location_roles USING btree (utilisateur_id);


--
-- Name: idx_user_sessions_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_sessions_active ON public.user_sessions USING btree (utilisateur_id, is_active) WHERE (is_active = true);


--
-- Name: idx_user_sessions_token; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_sessions_token ON public.user_sessions USING btree (token_hash);


--
-- Name: idx_user_sessions_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_sessions_user ON public.user_sessions USING btree (utilisateur_id);


--
-- Name: idx_utilisateur_locations_location; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_utilisateur_locations_location ON public.utilisateur_locations USING btree (location_id);


--
-- Name: idx_utilisateur_locations_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_utilisateur_locations_user ON public.utilisateur_locations USING btree (utilisateur_id);


--
-- Name: idx_utilisateurs_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_utilisateurs_email ON public.utilisateurs USING btree (email);


--
-- Name: idx_utilisateurs_username; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_utilisateurs_username ON public.utilisateurs USING btree (username);


--
-- Name: uq_acomptes_fourn_idempotency; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_acomptes_fourn_idempotency ON public.acomptes_fournisseur USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: uq_acomptes_idempotency; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_acomptes_idempotency ON public.acomptes_clients USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: uq_mouvements_idempotency; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_mouvements_idempotency ON public.mouvements_caisse USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: uq_paiements_fourn_idempotency; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_paiements_fourn_idempotency ON public.paiements_fournisseur USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: uq_paiements_idempotency; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_paiements_idempotency ON public.paiements USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: produits log_produits_stock; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER log_produits_stock AFTER UPDATE ON public.produits FOR EACH ROW EXECUTE FUNCTION public.log_mouvement_stock();


--
-- Name: acompte_applications trg_acompte_app_cap; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_acompte_app_cap AFTER INSERT OR UPDATE ON public.acompte_applications FOR EACH ROW EXECUTE FUNCTION public.enforce_acompte_application_cap();


--
-- Name: acompte_applications_fournisseur trg_acompte_fourn_cap; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_acompte_fourn_cap AFTER INSERT OR UPDATE ON public.acompte_applications_fournisseur FOR EACH ROW EXECUTE FUNCTION public.enforce_acompte_fournisseur_application_cap();


--
-- Name: acompte_applications_fournisseur trg_acompte_fourn_sync; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_acompte_fourn_sync AFTER INSERT OR DELETE OR UPDATE ON public.acompte_applications_fournisseur FOR EACH ROW EXECUTE FUNCTION public.sync_acompte_fournisseur_state();


--
-- Name: paiements trg_after_payment_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_after_payment_insert AFTER INSERT OR DELETE OR UPDATE ON public.paiements FOR EACH ROW EXECUTE FUNCTION public.update_facture_payment_status();


--
-- Name: demandes_reapprovisionnement trg_demande_state_change; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_demande_state_change AFTER UPDATE ON public.demandes_reapprovisionnement FOR EACH ROW EXECUTE FUNCTION public.log_demande_state_change();


--
-- Name: factures trg_facture_client_ecriture; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_facture_client_ecriture AFTER INSERT ON public.factures FOR EACH ROW EXECUTE FUNCTION public.create_ecritures_facture_client();


--
-- Name: factures_fournisseur trg_facture_fournisseur_ecriture; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_facture_fournisseur_ecriture AFTER INSERT ON public.factures_fournisseur FOR EACH ROW EXECUTE FUNCTION public.create_ecritures_facture_fournisseur();


--
-- Name: factures trg_facture_ht_ttc; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_facture_ht_ttc BEFORE INSERT OR UPDATE ON public.factures FOR EACH ROW EXECUTE FUNCTION public.update_facture_ht_ttc();


--
-- Name: mouvements_caisse trg_mouvement_append_only; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_mouvement_append_only BEFORE INSERT OR DELETE OR UPDATE ON public.mouvements_caisse FOR EACH ROW EXECUTE FUNCTION public.enforce_mouvement_append_only();


--
-- Name: mouvements_caisse trg_mouvement_magasin_coherence; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_mouvement_magasin_coherence BEFORE INSERT ON public.mouvements_caisse FOR EACH ROW EXECUTE FUNCTION public.enforce_mouvement_magasin_coherence();


--
-- Name: paiements trg_paiement_espece_mouvement; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE CONSTRAINT TRIGGER trg_paiement_espece_mouvement AFTER INSERT OR UPDATE OF methode_paiement, source, mouvement_caisse_id ON public.paiements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_paiement_espece_mouvement();


--
-- Name: paiements_fournisseur trg_paiement_ff_iud; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_paiement_ff_iud AFTER INSERT OR DELETE OR UPDATE ON public.paiements_fournisseur FOR EACH ROW EXECUTE FUNCTION public.update_facture_fournisseur_payment_status();


--
-- Name: acompte_applications trg_sync_acompte_after_app; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_sync_acompte_after_app AFTER INSERT OR DELETE OR UPDATE ON public.acompte_applications FOR EACH ROW EXECUTE FUNCTION public.sync_acompte_after_application();


--
-- Name: stock_transfers trg_sync_demande_transfer; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_sync_demande_transfer AFTER INSERT OR UPDATE ON public.stock_transfers FOR EACH ROW EXECUTE FUNCTION public.sync_demande_on_transfer_change();


--
-- Name: stock_par_location trg_sync_produits_stock; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_sync_produits_stock AFTER INSERT OR DELETE OR UPDATE ON public.stock_par_location FOR EACH ROW EXECUTE FUNCTION public.update_produits_stock_from_locations();


--
-- Name: tiers trg_tiers_code; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_tiers_code BEFORE INSERT ON public.tiers FOR EACH ROW EXECUTE FUNCTION public.generate_tiers_code();


--
-- Name: bons_livraison update_bons_livraison_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_bons_livraison_updated_at BEFORE UPDATE ON public.bons_livraison FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: caisses update_caisses_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_caisses_updated_at BEFORE UPDATE ON public.caisses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: demandes_reapprovisionnement_lignes update_demandes_lignes_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_demandes_lignes_updated_at BEFORE UPDATE ON public.demandes_reapprovisionnement_lignes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: demandes_reapprovisionnement update_demandes_reapprovisionnement_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_demandes_reapprovisionnement_updated_at BEFORE UPDATE ON public.demandes_reapprovisionnement FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: depenses update_depenses_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_depenses_updated_at BEFORE UPDATE ON public.depenses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: devis update_devis_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_devis_updated_at BEFORE UPDATE ON public.devis FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: employes update_employes_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_employes_updated_at BEFORE UPDATE ON public.employes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: factures_avoir update_factures_avoir_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_factures_avoir_updated_at BEFORE UPDATE ON public.factures_avoir FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: factures_fournisseur update_factures_fournisseur_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_factures_fournisseur_updated_at BEFORE UPDATE ON public.factures_fournisseur FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: magasins update_magasins_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_magasins_updated_at BEFORE UPDATE ON public.magasins FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: mouvements_caisse update_mouvements_caisse_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_mouvements_caisse_updated_at BEFORE UPDATE ON public.mouvements_caisse FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: produits update_produits_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_produits_updated_at BEFORE UPDATE ON public.produits FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: sessions_caisse update_sessions_caisse_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_sessions_caisse_updated_at BEFORE UPDATE ON public.sessions_caisse FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: stock_locations update_stock_locations_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_stock_locations_updated_at BEFORE UPDATE ON public.stock_locations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: stock_par_location update_stock_par_location_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_stock_par_location_updated_at BEFORE UPDATE ON public.stock_par_location FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: tiers update_tiers_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_tiers_updated_at BEFORE UPDATE ON public.tiers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: utilisateurs update_utilisateurs_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_utilisateurs_updated_at BEFORE UPDATE ON public.utilisateurs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: acompte_applications acompte_applications_acompte_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acompte_applications
    ADD CONSTRAINT acompte_applications_acompte_id_fkey FOREIGN KEY (acompte_id) REFERENCES public.acomptes_clients(id) ON DELETE RESTRICT;


--
-- Name: acompte_applications acompte_applications_cree_par_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acompte_applications
    ADD CONSTRAINT acompte_applications_cree_par_fkey FOREIGN KEY (cree_par) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: acompte_applications acompte_applications_facture_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acompte_applications
    ADD CONSTRAINT acompte_applications_facture_id_fkey FOREIGN KEY (facture_id) REFERENCES public.factures(id) ON DELETE RESTRICT;


--
-- Name: acompte_applications_fournisseur acompte_applications_fournisseur_acompte_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acompte_applications_fournisseur
    ADD CONSTRAINT acompte_applications_fournisseur_acompte_id_fkey FOREIGN KEY (acompte_id) REFERENCES public.acomptes_fournisseur(id) ON DELETE RESTRICT;


--
-- Name: acompte_applications_fournisseur acompte_applications_fournisseur_cree_par_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acompte_applications_fournisseur
    ADD CONSTRAINT acompte_applications_fournisseur_cree_par_fkey FOREIGN KEY (cree_par) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: acompte_applications_fournisseur acompte_applications_fournisseur_facture_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acompte_applications_fournisseur
    ADD CONSTRAINT acompte_applications_fournisseur_facture_id_fkey FOREIGN KEY (facture_id) REFERENCES public.factures_fournisseur(id) ON DELETE RESTRICT;


--
-- Name: acompte_applications_fournisseur acompte_applications_fournisseur_paiement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acompte_applications_fournisseur
    ADD CONSTRAINT acompte_applications_fournisseur_paiement_id_fkey FOREIGN KEY (paiement_id) REFERENCES public.paiements_fournisseur(id) ON DELETE SET NULL;


--
-- Name: acompte_applications acompte_applications_paiement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acompte_applications
    ADD CONSTRAINT acompte_applications_paiement_id_fkey FOREIGN KEY (paiement_id) REFERENCES public.paiements(id) ON DELETE SET NULL;


--
-- Name: acomptes_clients acomptes_clients_cree_par_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acomptes_clients
    ADD CONSTRAINT acomptes_clients_cree_par_fkey FOREIGN KEY (cree_par) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: acomptes_clients acomptes_clients_facture_id_applique_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acomptes_clients
    ADD CONSTRAINT acomptes_clients_facture_id_applique_fkey FOREIGN KEY (facture_id_applique) REFERENCES public.factures(id) ON DELETE SET NULL;


--
-- Name: acomptes_clients acomptes_clients_magasin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acomptes_clients
    ADD CONSTRAINT acomptes_clients_magasin_id_fkey FOREIGN KEY (magasin_id) REFERENCES public.magasins(id) ON DELETE RESTRICT;


--
-- Name: acomptes_clients acomptes_clients_mouvement_caisse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acomptes_clients
    ADD CONSTRAINT acomptes_clients_mouvement_caisse_id_fkey FOREIGN KEY (mouvement_caisse_id) REFERENCES public.mouvements_caisse(id) ON DELETE SET NULL;


--
-- Name: acomptes_clients acomptes_clients_rembourse_par_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acomptes_clients
    ADD CONSTRAINT acomptes_clients_rembourse_par_user_id_fkey FOREIGN KEY (rembourse_par_user_id) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: acomptes_clients acomptes_clients_session_caisse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acomptes_clients
    ADD CONSTRAINT acomptes_clients_session_caisse_id_fkey FOREIGN KEY (session_caisse_id) REFERENCES public.sessions_caisse(id) ON DELETE SET NULL;


--
-- Name: acomptes_clients acomptes_clients_tiers_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acomptes_clients
    ADD CONSTRAINT acomptes_clients_tiers_id_fkey FOREIGN KEY (tiers_id) REFERENCES public.tiers(id) ON DELETE CASCADE;


--
-- Name: acomptes_fournisseur acomptes_fournisseur_cree_par_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acomptes_fournisseur
    ADD CONSTRAINT acomptes_fournisseur_cree_par_fkey FOREIGN KEY (cree_par) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: acomptes_fournisseur acomptes_fournisseur_facture_id_applique_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acomptes_fournisseur
    ADD CONSTRAINT acomptes_fournisseur_facture_id_applique_fkey FOREIGN KEY (facture_id_applique) REFERENCES public.factures_fournisseur(id) ON DELETE SET NULL;


--
-- Name: acomptes_fournisseur acomptes_fournisseur_magasin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acomptes_fournisseur
    ADD CONSTRAINT acomptes_fournisseur_magasin_id_fkey FOREIGN KEY (magasin_id) REFERENCES public.magasins(id) ON DELETE SET NULL;


--
-- Name: acomptes_fournisseur acomptes_fournisseur_mouvement_caisse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acomptes_fournisseur
    ADD CONSTRAINT acomptes_fournisseur_mouvement_caisse_id_fkey FOREIGN KEY (mouvement_caisse_id) REFERENCES public.mouvements_caisse(id) ON DELETE SET NULL;


--
-- Name: acomptes_fournisseur acomptes_fournisseur_rembourse_par_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acomptes_fournisseur
    ADD CONSTRAINT acomptes_fournisseur_rembourse_par_user_id_fkey FOREIGN KEY (rembourse_par_user_id) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: acomptes_fournisseur acomptes_fournisseur_session_caisse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acomptes_fournisseur
    ADD CONSTRAINT acomptes_fournisseur_session_caisse_id_fkey FOREIGN KEY (session_caisse_id) REFERENCES public.sessions_caisse(id) ON DELETE SET NULL;


--
-- Name: acomptes_fournisseur acomptes_fournisseur_tiers_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.acomptes_fournisseur
    ADD CONSTRAINT acomptes_fournisseur_tiers_id_fkey FOREIGN KEY (tiers_id) REFERENCES public.tiers(id) ON DELETE CASCADE;


--
-- Name: allocation_audit allocation_audit_tiers_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_audit
    ADD CONSTRAINT allocation_audit_tiers_id_fkey FOREIGN KEY (tiers_id) REFERENCES public.tiers(id) ON DELETE CASCADE;


--
-- Name: audit_log audit_log_utilisateur_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_utilisateur_id_fkey FOREIGN KEY (utilisateur_id) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: barcode_scans barcode_scans_produit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.barcode_scans
    ADD CONSTRAINT barcode_scans_produit_id_fkey FOREIGN KEY (produit_id) REFERENCES public.produits(id) ON DELETE SET NULL;


--
-- Name: barcode_scans barcode_scans_utilisateur_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.barcode_scans
    ADD CONSTRAINT barcode_scans_utilisateur_id_fkey FOREIGN KEY (utilisateur_id) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: bon_livraison_lignes bon_livraison_lignes_bl_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bon_livraison_lignes
    ADD CONSTRAINT bon_livraison_lignes_bl_id_fkey FOREIGN KEY (bl_id) REFERENCES public.bons_livraison(id) ON DELETE CASCADE;


--
-- Name: bon_livraison_lignes bon_livraison_lignes_produit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bon_livraison_lignes
    ADD CONSTRAINT bon_livraison_lignes_produit_id_fkey FOREIGN KEY (produit_id) REFERENCES public.produits(id) ON DELETE SET NULL;


--
-- Name: bons_livraison bons_livraison_cree_par_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bons_livraison
    ADD CONSTRAINT bons_livraison_cree_par_fkey FOREIGN KEY (cree_par) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: bons_livraison bons_livraison_devis_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bons_livraison
    ADD CONSTRAINT bons_livraison_devis_id_fkey FOREIGN KEY (devis_id) REFERENCES public.devis(id) ON DELETE SET NULL;


--
-- Name: bons_livraison bons_livraison_facture_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bons_livraison
    ADD CONSTRAINT bons_livraison_facture_id_fkey FOREIGN KEY (facture_id) REFERENCES public.factures(id) ON DELETE SET NULL;


--
-- Name: bons_livraison bons_livraison_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bons_livraison
    ADD CONSTRAINT bons_livraison_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.stock_locations(id) ON DELETE SET NULL;


--
-- Name: bons_livraison bons_livraison_tiers_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bons_livraison
    ADD CONSTRAINT bons_livraison_tiers_id_fkey FOREIGN KEY (tiers_id) REFERENCES public.tiers(id) ON DELETE RESTRICT;


--
-- Name: caisses caisses_caisse_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.caisses
    ADD CONSTRAINT caisses_caisse_parent_id_fkey FOREIGN KEY (caisse_parent_id) REFERENCES public.caisses(id) ON DELETE SET NULL;


--
-- Name: caisses caisses_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.caisses
    ADD CONSTRAINT caisses_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.stock_locations(id) ON DELETE SET NULL;


--
-- Name: categories_depenses categories_depenses_compte_comptable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories_depenses
    ADD CONSTRAINT categories_depenses_compte_comptable_id_fkey FOREIGN KEY (compte_comptable_id) REFERENCES public.plan_comptable(id) ON DELETE SET NULL;


--
-- Name: commande_lignes commande_lignes_commande_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.commande_lignes
    ADD CONSTRAINT commande_lignes_commande_id_fkey FOREIGN KEY (commande_id) REFERENCES public.commandes_fournisseur(id) ON DELETE CASCADE;


--
-- Name: commande_lignes commande_lignes_produit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.commande_lignes
    ADD CONSTRAINT commande_lignes_produit_id_fkey FOREIGN KEY (produit_id) REFERENCES public.produits(id) ON DELETE RESTRICT;


--
-- Name: commandes_fournisseur commandes_fournisseur_tiers_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.commandes_fournisseur
    ADD CONSTRAINT commandes_fournisseur_tiers_id_fkey FOREIGN KEY (tiers_id) REFERENCES public.tiers(id) ON DELETE RESTRICT;


--
-- Name: compensations compensations_cree_par_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.compensations
    ADD CONSTRAINT compensations_cree_par_fkey FOREIGN KEY (cree_par) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: compensations compensations_ecriture_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.compensations
    ADD CONSTRAINT compensations_ecriture_id_fkey FOREIGN KEY (ecriture_id) REFERENCES public.ecritures_comptables(id) ON DELETE SET NULL;


--
-- Name: compensations compensations_tiers_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.compensations
    ADD CONSTRAINT compensations_tiers_id_fkey FOREIGN KEY (tiers_id) REFERENCES public.tiers(id) ON DELETE RESTRICT;


--
-- Name: compte_client_lignes compte_client_lignes_cree_par_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.compte_client_lignes
    ADD CONSTRAINT compte_client_lignes_cree_par_fkey FOREIGN KEY (cree_par) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: compte_client_lignes compte_client_lignes_tiers_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.compte_client_lignes
    ADD CONSTRAINT compte_client_lignes_tiers_id_fkey FOREIGN KEY (tiers_id) REFERENCES public.tiers(id) ON DELETE CASCADE;


--
-- Name: compte_fournisseur_lignes compte_fournisseur_lignes_cree_par_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.compte_fournisseur_lignes
    ADD CONSTRAINT compte_fournisseur_lignes_cree_par_fkey FOREIGN KEY (cree_par) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: compte_fournisseur_lignes compte_fournisseur_lignes_tiers_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.compte_fournisseur_lignes
    ADD CONSTRAINT compte_fournisseur_lignes_tiers_id_fkey FOREIGN KEY (tiers_id) REFERENCES public.tiers(id) ON DELETE RESTRICT;


--
-- Name: demandes_reapprovisionnement demandes_reapprovisionnement_closed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.demandes_reapprovisionnement
    ADD CONSTRAINT demandes_reapprovisionnement_closed_by_user_id_fkey FOREIGN KEY (closed_by_user_id) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: demandes_reapprovisionnement demandes_reapprovisionnement_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.demandes_reapprovisionnement
    ADD CONSTRAINT demandes_reapprovisionnement_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: demandes_reapprovisionnement demandes_reapprovisionnement_decided_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.demandes_reapprovisionnement
    ADD CONSTRAINT demandes_reapprovisionnement_decided_by_user_id_fkey FOREIGN KEY (decided_by_user_id) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: demandes_reapprovisionnement demandes_reapprovisionnement_depot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.demandes_reapprovisionnement
    ADD CONSTRAINT demandes_reapprovisionnement_depot_id_fkey FOREIGN KEY (depot_id) REFERENCES public.stock_locations(id) ON DELETE RESTRICT;


--
-- Name: demandes_reapprovisionnement demandes_reapprovisionnement_executed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.demandes_reapprovisionnement
    ADD CONSTRAINT demandes_reapprovisionnement_executed_by_user_id_fkey FOREIGN KEY (executed_by_user_id) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: demandes_reapprovisionnement_history demandes_reapprovisionnement_history_demande_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.demandes_reapprovisionnement_history
    ADD CONSTRAINT demandes_reapprovisionnement_history_demande_id_fkey FOREIGN KEY (demande_id) REFERENCES public.demandes_reapprovisionnement(id) ON DELETE CASCADE;


--
-- Name: demandes_reapprovisionnement_history demandes_reapprovisionnement_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.demandes_reapprovisionnement_history
    ADD CONSTRAINT demandes_reapprovisionnement_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: demandes_reapprovisionnement_lignes demandes_reapprovisionnement_lignes_demande_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.demandes_reapprovisionnement_lignes
    ADD CONSTRAINT demandes_reapprovisionnement_lignes_demande_id_fkey FOREIGN KEY (demande_id) REFERENCES public.demandes_reapprovisionnement(id) ON DELETE CASCADE;


--
-- Name: demandes_reapprovisionnement_lignes demandes_reapprovisionnement_lignes_produit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.demandes_reapprovisionnement_lignes
    ADD CONSTRAINT demandes_reapprovisionnement_lignes_produit_id_fkey FOREIGN KEY (produit_id) REFERENCES public.produits(id) ON DELETE RESTRICT;


--
-- Name: demandes_reapprovisionnement demandes_reapprovisionnement_magasin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.demandes_reapprovisionnement
    ADD CONSTRAINT demandes_reapprovisionnement_magasin_id_fkey FOREIGN KEY (magasin_id) REFERENCES public.stock_locations(id) ON DELETE RESTRICT;


--
-- Name: demandes_reapprovisionnement demandes_reapprovisionnement_transfert_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.demandes_reapprovisionnement
    ADD CONSTRAINT demandes_reapprovisionnement_transfert_id_fkey FOREIGN KEY (transfert_id) REFERENCES public.stock_transfers(id) ON DELETE SET NULL;


--
-- Name: depenses depenses_categorie_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.depenses
    ADD CONSTRAINT depenses_categorie_id_fkey FOREIGN KEY (categorie_id) REFERENCES public.categories_depenses(id) ON DELETE RESTRICT;


--
-- Name: depenses depenses_cree_par_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.depenses
    ADD CONSTRAINT depenses_cree_par_fkey FOREIGN KEY (cree_par) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: depenses depenses_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.depenses
    ADD CONSTRAINT depenses_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.stock_locations(id) ON DELETE SET NULL;


--
-- Name: depenses depenses_magasin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.depenses
    ADD CONSTRAINT depenses_magasin_id_fkey FOREIGN KEY (magasin_id) REFERENCES public.magasins(id) ON DELETE RESTRICT;


--
-- Name: depenses depenses_mouvement_caisse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.depenses
    ADD CONSTRAINT depenses_mouvement_caisse_id_fkey FOREIGN KEY (mouvement_caisse_id) REFERENCES public.mouvements_caisse(id) ON DELETE SET NULL;


--
-- Name: depenses depenses_session_caisse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.depenses
    ADD CONSTRAINT depenses_session_caisse_id_fkey FOREIGN KEY (session_caisse_id) REFERENCES public.sessions_caisse(id) ON DELETE SET NULL;


--
-- Name: depenses depenses_tiers_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.depenses
    ADD CONSTRAINT depenses_tiers_id_fkey FOREIGN KEY (tiers_id) REFERENCES public.tiers(id) ON DELETE SET NULL;


--
-- Name: devis devis_cree_par_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.devis
    ADD CONSTRAINT devis_cree_par_fkey FOREIGN KEY (cree_par) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: devis devis_facture_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.devis
    ADD CONSTRAINT devis_facture_id_fkey FOREIGN KEY (facture_id) REFERENCES public.factures(id) ON DELETE SET NULL;


--
-- Name: devis_lignes devis_lignes_devis_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.devis_lignes
    ADD CONSTRAINT devis_lignes_devis_id_fkey FOREIGN KEY (devis_id) REFERENCES public.devis(id) ON DELETE CASCADE;


--
-- Name: devis_lignes devis_lignes_produit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.devis_lignes
    ADD CONSTRAINT devis_lignes_produit_id_fkey FOREIGN KEY (produit_id) REFERENCES public.produits(id) ON DELETE SET NULL;


--
-- Name: devis devis_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.devis
    ADD CONSTRAINT devis_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.stock_locations(id) ON DELETE SET NULL;


--
-- Name: devis devis_tiers_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.devis
    ADD CONSTRAINT devis_tiers_id_fkey FOREIGN KEY (tiers_id) REFERENCES public.tiers(id) ON DELETE RESTRICT;


--
-- Name: document_lignes document_lignes_parent_ligne_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.document_lignes
    ADD CONSTRAINT document_lignes_parent_ligne_id_fkey FOREIGN KEY (parent_ligne_id) REFERENCES public.document_lignes(id) ON DELETE SET NULL;


--
-- Name: document_lignes document_lignes_produit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.document_lignes
    ADD CONSTRAINT document_lignes_produit_id_fkey FOREIGN KEY (produit_id) REFERENCES public.produits(id) ON DELETE SET NULL;


--
-- Name: ecritures_comptables ecritures_comptables_compte_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ecritures_comptables
    ADD CONSTRAINT ecritures_comptables_compte_id_fkey FOREIGN KEY (compte_id) REFERENCES public.plan_comptable(id) ON DELETE RESTRICT;


--
-- Name: employes employes_utilisateur_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employes
    ADD CONSTRAINT employes_utilisateur_id_fkey FOREIGN KEY (utilisateur_id) REFERENCES public.utilisateurs(id) ON DELETE CASCADE;


--
-- Name: facture_avoir_lignes facture_avoir_lignes_avoir_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.facture_avoir_lignes
    ADD CONSTRAINT facture_avoir_lignes_avoir_id_fkey FOREIGN KEY (avoir_id) REFERENCES public.factures_avoir(id) ON DELETE CASCADE;


--
-- Name: facture_avoir_lignes facture_avoir_lignes_produit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.facture_avoir_lignes
    ADD CONSTRAINT facture_avoir_lignes_produit_id_fkey FOREIGN KEY (produit_id) REFERENCES public.produits(id) ON DELETE SET NULL;


--
-- Name: facture_avoir_lignes facture_avoir_lignes_taux_tva_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.facture_avoir_lignes
    ADD CONSTRAINT facture_avoir_lignes_taux_tva_id_fkey FOREIGN KEY (taux_tva_id) REFERENCES public.taux_tva(id) ON DELETE SET NULL;


--
-- Name: facture_fournisseur_lignes facture_fournisseur_lignes_facture_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.facture_fournisseur_lignes
    ADD CONSTRAINT facture_fournisseur_lignes_facture_id_fkey FOREIGN KEY (facture_id) REFERENCES public.factures_fournisseur(id) ON DELETE CASCADE;


--
-- Name: facture_fournisseur_lignes facture_fournisseur_lignes_produit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.facture_fournisseur_lignes
    ADD CONSTRAINT facture_fournisseur_lignes_produit_id_fkey FOREIGN KEY (produit_id) REFERENCES public.produits(id) ON DELETE SET NULL;


--
-- Name: factures_avoir factures_avoir_cree_par_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.factures_avoir
    ADD CONSTRAINT factures_avoir_cree_par_fkey FOREIGN KEY (cree_par) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: factures_avoir factures_avoir_facture_appliquee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.factures_avoir
    ADD CONSTRAINT factures_avoir_facture_appliquee_id_fkey FOREIGN KEY (facture_appliquee_id) REFERENCES public.factures(id) ON DELETE SET NULL;


--
-- Name: factures_avoir factures_avoir_facture_origine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.factures_avoir
    ADD CONSTRAINT factures_avoir_facture_origine_id_fkey FOREIGN KEY (facture_origine_id) REFERENCES public.factures(id) ON DELETE SET NULL;


--
-- Name: factures_avoir factures_avoir_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.factures_avoir
    ADD CONSTRAINT factures_avoir_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.stock_locations(id) ON DELETE SET NULL;


--
-- Name: factures_avoir factures_avoir_retour_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.factures_avoir
    ADD CONSTRAINT factures_avoir_retour_id_fkey FOREIGN KEY (retour_id) REFERENCES public.retours(id) ON DELETE SET NULL;


--
-- Name: factures_avoir factures_avoir_tiers_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.factures_avoir
    ADD CONSTRAINT factures_avoir_tiers_id_fkey FOREIGN KEY (tiers_id) REFERENCES public.tiers(id) ON DELETE RESTRICT;


--
-- Name: factures factures_cree_par_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.factures
    ADD CONSTRAINT factures_cree_par_fkey FOREIGN KEY (cree_par) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: factures_fournisseur factures_fournisseur_commande_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.factures_fournisseur
    ADD CONSTRAINT factures_fournisseur_commande_id_fkey FOREIGN KEY (commande_id) REFERENCES public.commandes_fournisseur(id) ON DELETE SET NULL;


--
-- Name: factures_fournisseur factures_fournisseur_cree_par_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.factures_fournisseur
    ADD CONSTRAINT factures_fournisseur_cree_par_fkey FOREIGN KEY (cree_par) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: factures_fournisseur factures_fournisseur_reception_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.factures_fournisseur
    ADD CONSTRAINT factures_fournisseur_reception_id_fkey FOREIGN KEY (reception_id) REFERENCES public.receptions(id) ON DELETE SET NULL;


--
-- Name: factures_fournisseur factures_fournisseur_tiers_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.factures_fournisseur
    ADD CONSTRAINT factures_fournisseur_tiers_id_fkey FOREIGN KEY (tiers_id) REFERENCES public.tiers(id) ON DELETE RESTRICT;


--
-- Name: factures factures_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.factures
    ADD CONSTRAINT factures_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.stock_locations(id) ON DELETE SET NULL;


--
-- Name: factures factures_magasin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.factures
    ADD CONSTRAINT factures_magasin_id_fkey FOREIGN KEY (magasin_id) REFERENCES public.magasins(id) ON DELETE RESTRICT;


--
-- Name: factures factures_modifie_par_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.factures
    ADD CONSTRAINT factures_modifie_par_fkey FOREIGN KEY (modifie_par) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: factures factures_tiers_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.factures
    ADD CONSTRAINT factures_tiers_id_fkey FOREIGN KEY (tiers_id) REFERENCES public.tiers(id) ON DELETE RESTRICT;


--
-- Name: mouvements_caisse fk_mouvements_caisse_session; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mouvements_caisse
    ADD CONSTRAINT fk_mouvements_caisse_session FOREIGN KEY (session_caisse_id) REFERENCES public.sessions_caisse(id) ON DELETE CASCADE;


--
-- Name: _deprecated_internal_stock_request_lignes internal_stock_request_lignes_produit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._deprecated_internal_stock_request_lignes
    ADD CONSTRAINT internal_stock_request_lignes_produit_id_fkey FOREIGN KEY (produit_id) REFERENCES public.produits(id) ON DELETE RESTRICT;


--
-- Name: _deprecated_internal_stock_request_lignes internal_stock_request_lignes_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._deprecated_internal_stock_request_lignes
    ADD CONSTRAINT internal_stock_request_lignes_request_id_fkey FOREIGN KEY (request_id) REFERENCES public._deprecated_internal_stock_requests(id) ON DELETE CASCADE;


--
-- Name: _deprecated_internal_stock_requests internal_stock_requests_cree_par_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._deprecated_internal_stock_requests
    ADD CONSTRAINT internal_stock_requests_cree_par_fkey FOREIGN KEY (cree_par) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: _deprecated_internal_stock_requests internal_stock_requests_depot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._deprecated_internal_stock_requests
    ADD CONSTRAINT internal_stock_requests_depot_id_fkey FOREIGN KEY (depot_id) REFERENCES public.stock_locations(id) ON DELETE RESTRICT;


--
-- Name: _deprecated_internal_stock_requests internal_stock_requests_execute_par_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._deprecated_internal_stock_requests
    ADD CONSTRAINT internal_stock_requests_execute_par_fkey FOREIGN KEY (execute_par) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: _deprecated_internal_stock_requests internal_stock_requests_magasin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._deprecated_internal_stock_requests
    ADD CONSTRAINT internal_stock_requests_magasin_id_fkey FOREIGN KEY (magasin_id) REFERENCES public.stock_locations(id) ON DELETE RESTRICT;


--
-- Name: _deprecated_internal_stock_requests internal_stock_requests_transfer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._deprecated_internal_stock_requests
    ADD CONSTRAINT internal_stock_requests_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES public.stock_transfers(id) ON DELETE SET NULL;


--
-- Name: _deprecated_internal_stock_requests internal_stock_requests_valide_par_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._deprecated_internal_stock_requests
    ADD CONSTRAINT internal_stock_requests_valide_par_fkey FOREIGN KEY (valide_par) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: lots lots_produit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lots
    ADD CONSTRAINT lots_produit_id_fkey FOREIGN KEY (produit_id) REFERENCES public.produits(id) ON DELETE CASCADE;


--
-- Name: magasins magasins_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.magasins
    ADD CONSTRAINT magasins_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.stock_locations(id) ON DELETE CASCADE;


--
-- Name: mouvements_caisse mouvements_caisse_cree_par_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mouvements_caisse
    ADD CONSTRAINT mouvements_caisse_cree_par_fkey FOREIGN KEY (cree_par) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: mouvements_caisse mouvements_caisse_magasin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mouvements_caisse
    ADD CONSTRAINT mouvements_caisse_magasin_id_fkey FOREIGN KEY (magasin_id) REFERENCES public.magasins(id) ON DELETE RESTRICT;


--
-- Name: mouvements_caisse mouvements_caisse_reversed_by_mouvement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mouvements_caisse
    ADD CONSTRAINT mouvements_caisse_reversed_by_mouvement_id_fkey FOREIGN KEY (reversed_by_mouvement_id) REFERENCES public.mouvements_caisse(id) ON DELETE SET NULL;


--
-- Name: mouvements_caisse mouvements_caisse_reverses_mouvement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mouvements_caisse
    ADD CONSTRAINT mouvements_caisse_reverses_mouvement_id_fkey FOREIGN KEY (reverses_mouvement_id) REFERENCES public.mouvements_caisse(id) ON DELETE SET NULL;


--
-- Name: mouvements_caisse mouvements_caisse_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mouvements_caisse
    ADD CONSTRAINT mouvements_caisse_session_id_fkey FOREIGN KEY (session_caisse_id) REFERENCES public.sessions_caisse(id) ON DELETE CASCADE;


--
-- Name: mouvements_stock mouvements_stock_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mouvements_stock
    ADD CONSTRAINT mouvements_stock_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.stock_locations(id) ON DELETE SET NULL;


--
-- Name: mouvements_stock mouvements_stock_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mouvements_stock
    ADD CONSTRAINT mouvements_stock_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.lots(id) ON DELETE SET NULL;


--
-- Name: mouvements_stock mouvements_stock_numero_serie_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mouvements_stock
    ADD CONSTRAINT mouvements_stock_numero_serie_id_fkey FOREIGN KEY (numero_serie_id) REFERENCES public.numeros_serie(id) ON DELETE SET NULL;


--
-- Name: mouvements_stock mouvements_stock_produit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mouvements_stock
    ADD CONSTRAINT mouvements_stock_produit_id_fkey FOREIGN KEY (produit_id) REFERENCES public.produits(id) ON DELETE CASCADE;


--
-- Name: mouvements_stock mouvements_stock_transfer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mouvements_stock
    ADD CONSTRAINT mouvements_stock_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES public.stock_transfers(id) ON DELETE SET NULL;


--
-- Name: numeros_serie numeros_serie_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.numeros_serie
    ADD CONSTRAINT numeros_serie_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.lots(id) ON DELETE SET NULL;


--
-- Name: numeros_serie numeros_serie_produit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.numeros_serie
    ADD CONSTRAINT numeros_serie_produit_id_fkey FOREIGN KEY (produit_id) REFERENCES public.produits(id) ON DELETE CASCADE;


--
-- Name: paiements paiements_cree_par_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.paiements
    ADD CONSTRAINT paiements_cree_par_fkey FOREIGN KEY (cree_par) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: paiements paiements_facture_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.paiements
    ADD CONSTRAINT paiements_facture_id_fkey FOREIGN KEY (facture_id) REFERENCES public.factures(id) ON DELETE CASCADE;


--
-- Name: paiements_fournisseur paiements_fournisseur_effectue_par_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.paiements_fournisseur
    ADD CONSTRAINT paiements_fournisseur_effectue_par_fkey FOREIGN KEY (effectue_par) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: paiements_fournisseur paiements_fournisseur_facture_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.paiements_fournisseur
    ADD CONSTRAINT paiements_fournisseur_facture_id_fkey FOREIGN KEY (facture_id) REFERENCES public.factures_fournisseur(id) ON DELETE CASCADE;


--
-- Name: paiements_fournisseur paiements_fournisseur_magasin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.paiements_fournisseur
    ADD CONSTRAINT paiements_fournisseur_magasin_id_fkey FOREIGN KEY (magasin_id) REFERENCES public.magasins(id) ON DELETE RESTRICT;


--
-- Name: paiements_fournisseur paiements_fournisseur_mouvement_caisse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.paiements_fournisseur
    ADD CONSTRAINT paiements_fournisseur_mouvement_caisse_id_fkey FOREIGN KEY (mouvement_caisse_id) REFERENCES public.mouvements_caisse(id) ON DELETE SET NULL;


--
-- Name: paiements_fournisseur paiements_fournisseur_session_caisse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.paiements_fournisseur
    ADD CONSTRAINT paiements_fournisseur_session_caisse_id_fkey FOREIGN KEY (session_caisse_id) REFERENCES public.sessions_caisse(id) ON DELETE SET NULL;


--
-- Name: paiements paiements_magasin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.paiements
    ADD CONSTRAINT paiements_magasin_id_fkey FOREIGN KEY (magasin_id) REFERENCES public.magasins(id) ON DELETE RESTRICT;


--
-- Name: paiements paiements_mouvement_caisse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.paiements
    ADD CONSTRAINT paiements_mouvement_caisse_id_fkey FOREIGN KEY (mouvement_caisse_id) REFERENCES public.mouvements_caisse(id) ON DELETE SET NULL;


--
-- Name: paiements paiements_session_caisse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.paiements
    ADD CONSTRAINT paiements_session_caisse_id_fkey FOREIGN KEY (session_caisse_id) REFERENCES public.sessions_caisse(id) ON DELETE SET NULL;


--
-- Name: pos_cart_items pos_cart_items_produit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pos_cart_items
    ADD CONSTRAINT pos_cart_items_produit_id_fkey FOREIGN KEY (produit_id) REFERENCES public.produits(id) ON DELETE RESTRICT;


--
-- Name: pos_cart_items pos_cart_items_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pos_cart_items
    ADD CONSTRAINT pos_cart_items_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.pos_sessions(id) ON DELETE CASCADE;


--
-- Name: pos_sessions pos_sessions_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pos_sessions
    ADD CONSTRAINT pos_sessions_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.stock_locations(id) ON DELETE SET NULL;


--
-- Name: pos_sessions pos_sessions_utilisateur_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pos_sessions
    ADD CONSTRAINT pos_sessions_utilisateur_id_fkey FOREIGN KEY (utilisateur_id) REFERENCES public.utilisateurs(id) ON DELETE RESTRICT;


--
-- Name: produits produits_cree_par_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.produits
    ADD CONSTRAINT produits_cree_par_fkey FOREIGN KEY (cree_par) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: produits produits_modifie_par_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.produits
    ADD CONSTRAINT produits_modifie_par_fkey FOREIGN KEY (modifie_par) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: produits produits_tiers_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.produits
    ADD CONSTRAINT produits_tiers_id_fkey FOREIGN KEY (fournisseur_id) REFERENCES public.tiers(id) ON DELETE SET NULL;


--
-- Name: reception_lignes reception_lignes_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reception_lignes
    ADD CONSTRAINT reception_lignes_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.lots(id) ON DELETE SET NULL;


--
-- Name: reception_lignes reception_lignes_produit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reception_lignes
    ADD CONSTRAINT reception_lignes_produit_id_fkey FOREIGN KEY (produit_id) REFERENCES public.produits(id) ON DELETE RESTRICT;


--
-- Name: reception_lignes reception_lignes_reception_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reception_lignes
    ADD CONSTRAINT reception_lignes_reception_id_fkey FOREIGN KEY (reception_id) REFERENCES public.receptions(id) ON DELETE CASCADE;


--
-- Name: receptions receptions_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.receptions
    ADD CONSTRAINT receptions_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.stock_locations(id) ON DELETE SET NULL;


--
-- Name: receptions receptions_receptionne_par_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.receptions
    ADD CONSTRAINT receptions_receptionne_par_fkey FOREIGN KEY (receptionne_par) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: retour_lignes retour_lignes_facture_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.retour_lignes
    ADD CONSTRAINT retour_lignes_facture_id_fkey FOREIGN KEY (facture_id) REFERENCES public.factures(id) ON DELETE RESTRICT;


--
-- Name: retour_lignes retour_lignes_produit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.retour_lignes
    ADD CONSTRAINT retour_lignes_produit_id_fkey FOREIGN KEY (produit_id) REFERENCES public.produits(id) ON DELETE RESTRICT;


--
-- Name: retour_lignes retour_lignes_retour_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.retour_lignes
    ADD CONSTRAINT retour_lignes_retour_id_fkey FOREIGN KEY (retour_id) REFERENCES public.retours(id) ON DELETE CASCADE;


--
-- Name: retours retours_cree_par_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.retours
    ADD CONSTRAINT retours_cree_par_fkey FOREIGN KEY (cree_par) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: retours retours_tiers_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.retours
    ADD CONSTRAINT retours_tiers_id_fkey FOREIGN KEY (tiers_id) REFERENCES public.tiers(id) ON DELETE RESTRICT;


--
-- Name: role_permissions role_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: sessions_caisse sessions_caisse_caisse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sessions_caisse
    ADD CONSTRAINT sessions_caisse_caisse_id_fkey FOREIGN KEY (caisse_id) REFERENCES public.caisses(id) ON DELETE SET NULL;


--
-- Name: sessions_caisse sessions_caisse_cloturee_par_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sessions_caisse
    ADD CONSTRAINT sessions_caisse_cloturee_par_user_id_fkey FOREIGN KEY (cloturee_par_user_id) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: sessions_caisse sessions_caisse_magasin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sessions_caisse
    ADD CONSTRAINT sessions_caisse_magasin_id_fkey FOREIGN KEY (magasin_id) REFERENCES public.magasins(id) ON DELETE RESTRICT;


--
-- Name: sessions_caisse sessions_caisse_ouverte_par_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sessions_caisse
    ADD CONSTRAINT sessions_caisse_ouverte_par_user_id_fkey FOREIGN KEY (ouverte_par_user_id) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: sessions_caisse sessions_caisse_utilisateur_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sessions_caisse
    ADD CONSTRAINT sessions_caisse_utilisateur_id_fkey FOREIGN KEY (utilisateur_id) REFERENCES public.utilisateurs(id) ON DELETE RESTRICT;


--
-- Name: sessions sessions_utilisateur_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_utilisateur_id_fkey FOREIGN KEY (utilisateur_id) REFERENCES public.utilisateurs(id) ON DELETE CASCADE;


--
-- Name: shifts_employes shifts_employes_employe_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shifts_employes
    ADD CONSTRAINT shifts_employes_employe_id_fkey FOREIGN KEY (employe_id) REFERENCES public.employes(id) ON DELETE CASCADE;


--
-- Name: stock_locations stock_locations_responsable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_locations
    ADD CONSTRAINT stock_locations_responsable_id_fkey FOREIGN KEY (responsable_id) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: stock_par_location stock_par_location_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_par_location
    ADD CONSTRAINT stock_par_location_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.stock_locations(id) ON DELETE CASCADE;


--
-- Name: stock_par_location stock_par_location_produit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_par_location
    ADD CONSTRAINT stock_par_location_produit_id_fkey FOREIGN KEY (produit_id) REFERENCES public.produits(id) ON DELETE CASCADE;


--
-- Name: stock_transfer_lignes stock_transfer_lignes_demande_ligne_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_transfer_lignes
    ADD CONSTRAINT stock_transfer_lignes_demande_ligne_id_fkey FOREIGN KEY (demande_ligne_id) REFERENCES public.demandes_reapprovisionnement_lignes(id) ON DELETE SET NULL;


--
-- Name: stock_transfer_lignes stock_transfer_lignes_produit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_transfer_lignes
    ADD CONSTRAINT stock_transfer_lignes_produit_id_fkey FOREIGN KEY (produit_id) REFERENCES public.produits(id) ON DELETE RESTRICT;


--
-- Name: stock_transfer_lignes stock_transfer_lignes_transfer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_transfer_lignes
    ADD CONSTRAINT stock_transfer_lignes_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES public.stock_transfers(id) ON DELETE CASCADE;


--
-- Name: stock_transfers stock_transfers_cree_par_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_cree_par_fkey FOREIGN KEY (cree_par) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: stock_transfers stock_transfers_demande_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_demande_id_fkey FOREIGN KEY (demande_id) REFERENCES public.demandes_reapprovisionnement(id) ON DELETE SET NULL;


--
-- Name: stock_transfers stock_transfers_location_destination_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_location_destination_id_fkey FOREIGN KEY (location_destination_id) REFERENCES public.stock_locations(id) ON DELETE RESTRICT;


--
-- Name: stock_transfers stock_transfers_location_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_transfers
    ADD CONSTRAINT stock_transfers_location_source_id_fkey FOREIGN KEY (location_source_id) REFERENCES public.stock_locations(id) ON DELETE RESTRICT;


--
-- Name: _deprecated_three_way_match_details_2026_05 three_way_match_details_match_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._deprecated_three_way_match_details_2026_05
    ADD CONSTRAINT three_way_match_details_match_id_fkey FOREIGN KEY (match_id) REFERENCES public._deprecated_three_way_matches_2026_05(id) ON DELETE CASCADE;


--
-- Name: _deprecated_three_way_match_details_2026_05 three_way_match_details_produit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._deprecated_three_way_match_details_2026_05
    ADD CONSTRAINT three_way_match_details_produit_id_fkey FOREIGN KEY (produit_id) REFERENCES public.produits(id) ON DELETE RESTRICT;


--
-- Name: _deprecated_three_way_matches_2026_05 three_way_matches_reception_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._deprecated_three_way_matches_2026_05
    ADD CONSTRAINT three_way_matches_reception_id_fkey FOREIGN KEY (reception_id) REFERENCES public.receptions(id) ON DELETE RESTRICT;


--
-- Name: _deprecated_three_way_matches_2026_05 three_way_matches_valide_par_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._deprecated_three_way_matches_2026_05
    ADD CONSTRAINT three_way_matches_valide_par_fkey FOREIGN KEY (valide_par) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: transferts_caisse transferts_caisse_caisse_dest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transferts_caisse
    ADD CONSTRAINT transferts_caisse_caisse_dest_id_fkey FOREIGN KEY (caisse_dest_id) REFERENCES public.caisses(id) ON DELETE RESTRICT;


--
-- Name: transferts_caisse transferts_caisse_caisse_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transferts_caisse
    ADD CONSTRAINT transferts_caisse_caisse_source_id_fkey FOREIGN KEY (caisse_source_id) REFERENCES public.caisses(id) ON DELETE RESTRICT;


--
-- Name: transferts_caisse transferts_caisse_cree_par_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transferts_caisse
    ADD CONSTRAINT transferts_caisse_cree_par_fkey FOREIGN KEY (cree_par) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: transferts_caisse transferts_caisse_valide_par_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transferts_caisse
    ADD CONSTRAINT transferts_caisse_valide_par_fkey FOREIGN KEY (valide_par) REFERENCES public.utilisateurs(id) ON DELETE SET NULL;


--
-- Name: user_location_roles user_location_roles_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_location_roles
    ADD CONSTRAINT user_location_roles_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.stock_locations(id) ON DELETE CASCADE;


--
-- Name: user_location_roles user_location_roles_utilisateur_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_location_roles
    ADD CONSTRAINT user_location_roles_utilisateur_id_fkey FOREIGN KEY (utilisateur_id) REFERENCES public.utilisateurs(id) ON DELETE CASCADE;


--
-- Name: user_permissions user_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: user_permissions user_permissions_utilisateur_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_utilisateur_id_fkey FOREIGN KEY (utilisateur_id) REFERENCES public.utilisateurs(id) ON DELETE CASCADE;


--
-- Name: user_sessions user_sessions_utilisateur_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_utilisateur_id_fkey FOREIGN KEY (utilisateur_id) REFERENCES public.utilisateurs(id) ON DELETE CASCADE;


--
-- Name: utilisateur_locations utilisateur_locations_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.utilisateur_locations
    ADD CONSTRAINT utilisateur_locations_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.stock_locations(id) ON DELETE CASCADE;


--
-- Name: utilisateur_locations utilisateur_locations_utilisateur_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.utilisateur_locations
    ADD CONSTRAINT utilisateur_locations_utilisateur_id_fkey FOREIGN KEY (utilisateur_id) REFERENCES public.utilisateurs(id) ON DELETE CASCADE;


--
-- Name: utilisateurs utilisateurs_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.utilisateurs
    ADD CONSTRAINT utilisateurs_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id);


--
-- Name: TABLE audit_log; Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON TABLE public.audit_log FROM postgres;
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.audit_log TO postgres;


--
-- PostgreSQL database dump complete
--

\unrestrict jo2T02qGMVeznCHVIbthgDbCMugArp4IZVuLGfk45IUxmY0gLr7ldzRw6aJt6JW

