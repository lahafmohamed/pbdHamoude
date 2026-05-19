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

async function fixAccountingTriggers() {
  const client = await pool.connect();

  try {
    console.log('Applying accounting trigger fix...');
    await client.query('BEGIN');

    await client.query(`
      CREATE OR REPLACE FUNCTION ensure_plan_compte(
        p_numero VARCHAR(20),
        p_intitule VARCHAR(255),
        p_type_compte VARCHAR(50),
        p_categorie VARCHAR(50)
      )
      RETURNS INTEGER AS $$
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
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION create_ecritures_facture_fournisseur()
      RETURNS TRIGGER AS $$
      DECLARE
        compte_achat_id INTEGER;
        compte_tva_id INTEGER;
        compte_fournisseur_id INTEGER;
      BEGIN
        compte_achat_id := ensure_plan_compte('601', 'Achats de marchandises', 'charge', 'classe6');
        compte_tva_id := ensure_plan_compte('4456', 'TVA déductible', 'actif', 'classe4');
        compte_fournisseur_id := ensure_plan_compte('401', 'Fournisseurs', 'passif', 'classe4');

        INSERT INTO ecritures_comptables (numero_piece, date_ecriture, journal, piece_id, piece_type, ligne_numero, compte_id, debit, credit, description)
        VALUES (NEW.numero_facture_interne, NEW.date_facture, 'ACHATS', NEW.id, 'facture_fournisseur', 1, compte_achat_id, NEW.sous_total, 0, 'Achat marchandises - ' || NEW.numero_facture_fournisseur);

        IF NEW.tva > 0 THEN
          INSERT INTO ecritures_comptables (numero_piece, date_ecriture, journal, piece_id, piece_type, ligne_numero, compte_id, debit, credit, description)
          VALUES (NEW.numero_facture_interne, NEW.date_facture, 'ACHATS', NEW.id, 'facture_fournisseur', 2, compte_tva_id, NEW.tva, 0, 'TVA deductible - ' || NEW.numero_facture_fournisseur);
        END IF;

        INSERT INTO ecritures_comptables (numero_piece, date_ecriture, journal, piece_id, piece_type, ligne_numero, compte_id, debit, credit, description)
        VALUES (NEW.numero_facture_interne, NEW.date_facture, 'ACHATS', NEW.id, 'facture_fournisseur', 3, compte_fournisseur_id, 0, NEW.total, 'Dette fournisseur - ' || NEW.numero_facture_fournisseur);

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION create_ecritures_facture_client()
      RETURNS TRIGGER AS $$
      DECLARE
        compte_vente_id INTEGER;
        compte_tva_id INTEGER;
        compte_client_id INTEGER;
      BEGIN
        compte_vente_id := ensure_plan_compte('701', 'Ventes de marchandises', 'produit', 'classe7');
        compte_tva_id := ensure_plan_compte('4457', 'TVA collectee', 'passif', 'classe4');
        compte_client_id := ensure_plan_compte('411', 'Clients', 'actif', 'classe4');

        INSERT INTO ecritures_comptables (numero_piece, date_ecriture, journal, piece_id, piece_type, ligne_numero, compte_id, debit, credit, description)
        VALUES (NEW.numero_facture, NEW.date_facture, 'VENTES', NEW.id, 'facture', 1, compte_client_id, NEW.total, 0, 'Vente client - ' || NEW.numero_facture);

        INSERT INTO ecritures_comptables (numero_piece, date_ecriture, journal, piece_id, piece_type, ligne_numero, compte_id, debit, credit, description)
        VALUES (NEW.numero_facture, NEW.date_facture, 'VENTES', NEW.id, 'facture', 2, compte_vente_id, 0, NEW.sous_total, 'Chiffre d''affaires - ' || NEW.numero_facture);

        IF NEW.tva > 0 THEN
          INSERT INTO ecritures_comptables (numero_piece, date_ecriture, journal, piece_id, piece_type, ligne_numero, compte_id, debit, credit, description)
          VALUES (NEW.numero_facture, NEW.date_facture, 'VENTES', NEW.id, 'facture', 3, compte_tva_id, 0, NEW.tva, 'TVA collectee - ' || NEW.numero_facture);
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query('DROP TRIGGER IF EXISTS trg_facture_fournisseur_ecriture ON factures_fournisseur;');
    await client.query('DROP TRIGGER IF EXISTS trg_facture_client_ecriture ON factures;');

    await client.query(`
      CREATE TRIGGER trg_facture_fournisseur_ecriture
        AFTER INSERT ON factures_fournisseur
        FOR EACH ROW
        EXECUTE FUNCTION create_ecritures_facture_fournisseur();
    `);

    await client.query(`
      CREATE TRIGGER trg_facture_client_ecriture
        AFTER INSERT ON factures
        FOR EACH ROW
        EXECUTE FUNCTION create_ecritures_facture_client();
    `);

    await client.query('COMMIT');
    console.log('Accounting trigger fix applied successfully.');
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

fixAccountingTriggers();
