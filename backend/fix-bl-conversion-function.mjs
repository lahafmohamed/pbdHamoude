import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'magasin_db',
});

async function fixBlConversionFunction() {
  const client = await pool.connect();

  try {
    console.log('Applying BL to facture conversion function fix (unified-tiers compatible)...');
    await client.query('BEGIN');

    await client.query(`
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
      $$ LANGUAGE plpgsql;
    `);

    await client.query('COMMIT');
    console.log('BL conversion function fix applied successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Fix failed:', error.message);
    if (error.detail) console.error('Detail:', error.detail);
    if (error.hint) console.error('Hint:', error.hint);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

fixBlConversionFunction();
