import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'pbdsarl',
  password: process.env.DB_PASSWORD || '',
  port: parseInt(process.env.DB_PORT || '5432'),
});

// Extracted from "SUIVI VENTE CLIENT PBD_SARL.xlsx" — solde > 0 = client nous doit (XOF)
// solde < 0 = client a versé en avance (acompte disponible)
const clients = [
  { nom: 'YOUBA ADZOPE', solde: 580000 },
  { nom: 'NETCOM', solde: 3660000 },
  { nom: 'FIDAA', solde: 6734350 },
  { nom: 'SOLO', solde: 3199500 },
  { nom: 'SENAT BL', solde: 193356500 },
  { nom: 'PETIT SOLO', solde: 170000 },
  { nom: 'SEINA', solde: 2160000 },
  { nom: 'SAMFO', solde: 3429 },
  { nom: 'FBD', solde: 33550350 },
  { nom: 'ARTCI', solde: 0 },
  { nom: 'AFCHEM-SOFACO', solde: 1682000 },
  { nom: 'MAN TPS', solde: -531500 },
  { nom: 'HACHICH INDIEN', solde: 0 },
  { nom: 'DIVERS CLIENT', solde: 360000 },
  { nom: 'SOGODO', solde: 1047500 },
  { nom: 'ALI CHERRI', solde: 643000 },
  { nom: 'KONE MOUSTAPHA', solde: 0 },
  { nom: 'DSC BATIME', solde: 0 },
  { nom: 'SIDI MOHAMAD', solde: 2230000 },
  { nom: 'SAMAKE KEBE', solde: 0 },
  { nom: 'ADAM AFRIQUE', solde: 6838100 },
  { nom: 'BILAL BIG MAT', solde: 278000 },
  { nom: 'ATL', solde: 1125000 },
  { nom: 'SALIF KONE', solde: 250000 },
  { nom: 'ABBAS ZALZALE', solde: 75000 },
  { nom: 'GMS GAKOU', solde: 0 },
  { nom: 'AEC', solde: 581000 },
  { nom: 'AYOKI', solde: 550000 },
  { nom: 'AGS AFRIQUE GROUPE SERVICE', solde: 42100 },
  { nom: 'BERNARD', solde: 415000 },
  { nom: 'MR KOUAME ASSOUA LUDOVIC', solde: 50000 },
  { nom: 'ALI JOMAA', solde: 1162422 },
  { nom: 'MEHDY MADY', solde: 744000 },
  { nom: 'ADNAN PRIME PRESTIGE', solde: 1725363000 },
  { nom: 'ABBAS ABDUL REDA', solde: 3629700 },
  { nom: 'A.H GROUPE', solde: 5130000 },
  { nom: 'WAEL', solde: 0 },
  { nom: 'CFAO', solde: 11981000 },
  { nom: 'CABF ALLCC', solde: 39559000 },
  { nom: 'MR. KEBE', solde: 5000000 },
  { nom: 'BATIPLUS', solde: 1418000 },
  { nom: 'NAFCO', solde: 555000 },
  { nom: 'ABDALLAH KDOUH', solde: 765000 },
  { nom: 'DISTRICT DU ZANZAN', solde: 11612500 },
  { nom: 'EZONE', solde: 190000 },
  { nom: 'KOBEISSI', solde: 26840000 },
  { nom: 'AUTO RAY(CLIENT)', solde: 0 },
  { nom: 'ALM', solde: 760000 },
];

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let newTiers = 0, mergedTiers = 0, factures = 0, acomptes = 0;

    for (const c of clients) {
      // Check existing tiers (any role) by name
      const { rows: existing } = await client.query(
        `SELECT id, est_client, est_fournisseur FROM tiers
         WHERE raison_sociale = $1 AND deleted_at IS NULL`,
        [c.nom]
      );

      let tiersId;
      if (existing.length > 0) {
        tiersId = existing[0].id;
        if (!existing[0].est_client) {
          await client.query(
            `UPDATE tiers SET est_client = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [tiersId]
          );
          mergedTiers++;
          console.log(`[merge] ${c.nom} (id=${tiersId}) → est_client=true`);
        } else {
          console.log(`[skip] ${c.nom} already client (id=${tiersId})`);
          continue;
        }
      } else {
        const { rows: inserted } = await client.query(
          `INSERT INTO tiers (raison_sociale, est_client, est_fournisseur, notes)
           VALUES ($1, true, false, $2) RETURNING id`,
          [c.nom, 'Importé depuis Excel SUIVI VENTE CLIENT (2026-05)']
        );
        tiersId = inserted[0].id;
        newTiers++;
        console.log(`[tiers] ${c.nom} → id=${tiersId}`);
      }

      if (c.solde > 0) {
        const { rows: seqRows } = await client.query(`SELECT nextval('facture_numero_seq') as num`);
        const numero = `FAC-SOLDE-${new Date().getFullYear()}-${String(seqRows[0].num).padStart(5, '0')}`;
        const today = new Date();

        const { rows: factRows } = await client.query(
          `INSERT INTO factures
             (numero_facture, tiers_id, date_facture, sous_total, tva, total,
              montant_paye, remaining_due, statut, notes)
           VALUES ($1, $2, $3, $4, 0, $4, 0, $4, 'en_attente', $5)
           RETURNING id`,
          [numero, tiersId, today, c.solde, 'Solde initial importé Excel']
        );
        const factureId = factRows[0].id;

        await client.query(
          `INSERT INTO document_lignes
             (document_type, document_id, description, quantite, prix_unitaire, total_ligne)
           VALUES ('facture', $1, 'SOLDE INITIAL', 1, $2, $2)`,
          [factureId, c.solde]
        );

        await client.query(
          `INSERT INTO compte_client_lignes
             (tiers_id, type_operation, document_id, document_numero,
              montant_debit, montant_credit, notes)
           VALUES ($1, 'facture', $2, $3, $4, 0, 'Solde initial importé Excel')`,
          [tiersId, factureId, numero, c.solde]
        );

        factures++;
        console.log(`  └─ facture ${c.solde.toLocaleString()} (${numero})`);
      } else if (c.solde < 0) {
        const montant = Math.abs(c.solde);
        await client.query(
          `INSERT INTO acomptes_clients
             (tiers_id, montant, montant_restant, methode_paiement, statut, notes)
           VALUES ($1, $2, $2, 'espece', 'disponible', 'Acompte initial importé Excel')`,
          [tiersId, montant]
        );
        acomptes++;
        console.log(`  └─ acompte disponible ${montant.toLocaleString()}`);
      }
    }

    await client.query('COMMIT');
    console.log(`\n✓ Done. Nouveaux tiers: ${newTiers}, Fusionnés (déjà fournisseur): ${mergedTiers}, Factures: ${factures}, Acomptes: ${acomptes}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
