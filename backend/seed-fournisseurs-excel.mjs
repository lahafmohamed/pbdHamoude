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

// Extracted from "NOUVEAU-SUIVIE FOURNISSEUR PBD_SARL.xlsx" — solde = montant qu'on leur doit (XOF)
const fournisseurs = [
  { nom: 'MAHMOUD CHAALAN', solde: 3030000 },
  { nom: 'CHINOIS', solde: 8150000 },
  { nom: 'SUNSTEEL - KEVIN', solde: 0 },
  { nom: 'MOUSTAPHA FAWAZ', solde: 330000 },
  { nom: 'PETIT SOLO', solde: 180000 },
  { nom: 'GEDIS', solde: 5535000 },
  { nom: 'MOHAMED ZALZALE', solde: 169171000 },
  { nom: 'AUTO ROY', solde: 0 },
  { nom: 'DUNLOP', solde: 11947660 },
  { nom: 'NABILCO', solde: 2615000 },
  { nom: 'KABALANE', solde: 2689649 },
  { nom: 'ABASS BOUGI', solde: 75000 },
  { nom: 'DIVERS', solde: 0 },
  { nom: 'ROULEMENT MONDIAL', solde: 6285.56 },
  { nom: 'CACOMIAF', solde: 0 },
  { nom: 'HASSAN KAFARANI', solde: 200000 },
  { nom: 'VICTOR', solde: 280000 },
  { nom: 'SOLO', solde: 70000 },
  { nom: 'ABASS KANSSA', solde: 0 },
  { nom: 'SAKO', solde: 0 },
  { nom: 'AHMAD WESLAKE', solde: 525000 },
  { nom: 'IRA', solde: 220000 },
  { nom: 'GGN PLAQUETTE', solde: 0 },
  { nom: 'LIQUI MOLY', solde: 0 },
  { nom: 'AKHIL DAHER', solde: 0 },
  { nom: 'CFAO MOBILITY', solde: 500055 },
  { nom: 'HASSAN SALAMAN', solde: 0 },
  { nom: 'SPRIINT-TECH - BOSCH', solde: 2185866 },
  { nom: 'MAHMOUD', solde: 3245500 },
  { nom: 'VINOD GRAISSE', solde: 0 },
  { nom: 'ABASS FARESS', solde: 0 },
  { nom: 'EXIM-IMPEX', solde: 0 },
  { nom: 'JOSEPH & CHARBEL', solde: 0 },
  { nom: 'BAKAYOKO', solde: 0 },
  { nom: 'FAO TOLIER', solde: 0 },
  { nom: 'BENARD PNEU', solde: 1515000 },
];

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let createdTiers = 0;
    let createdInvoices = 0;
    let skipped = 0;

    for (const f of fournisseurs) {
      const { rows: existing } = await client.query(
        `SELECT id FROM tiers WHERE raison_sociale = $1 AND est_fournisseur = true AND deleted_at IS NULL`,
        [f.nom]
      );

      let tiersId;
      if (existing.length > 0) {
        tiersId = existing[0].id;
        console.log(`[skip] ${f.nom} already exists (id=${tiersId})`);
        skipped++;
        continue;
      }

      const { rows: inserted } = await client.query(
        `INSERT INTO tiers (raison_sociale, est_client, est_fournisseur, notes)
         VALUES ($1, false, true, $2)
         RETURNING id`,
        [f.nom, 'Importé depuis Excel SUIVIE FOURNISSEUR (2026-05)']
      );
      tiersId = inserted[0].id;
      createdTiers++;
      console.log(`[tiers] ${f.nom} → id=${tiersId}`);

      if (f.solde > 0) {
        const { rows: seqRows } = await client.query(
          `SELECT nextval('facture_fournisseur_numero_seq') as num`
        );
        const numeroInterne = `FF-SOLDE-${new Date().getFullYear()}-${String(seqRows[0].num).padStart(5, '0')}`;
        const numeroFournisseur = `SOLDE-INITIAL-${f.nom.replace(/[^A-Z0-9]/gi, '').substring(0, 20)}`;
        const today = new Date().toISOString().split('T')[0];

        const { rows: invRows } = await client.query(
          `INSERT INTO factures_fournisseur
             (tiers_id, numero_facture_fournisseur, numero_facture_interne,
              date_facture, sous_total, tva, total, montant_paye, reste_due, statut, notes)
           VALUES ($1, $2, $3, $4, $5, 0, $5, 0, $5, 'validee', $6)
           RETURNING id`,
          [tiersId, numeroFournisseur, numeroInterne, today, f.solde, 'Solde initial importé Excel']
        );
        const invoiceId = invRows[0].id;

        await client.query(
          `INSERT INTO facture_fournisseur_lignes
             (facture_id, description, quantite, prix_unitaire, total_ligne)
           VALUES ($1, 'SOLDE INITIAL', 1, $2, $2)`,
          [invoiceId, f.solde]
        );

        await client.query(
          `INSERT INTO compte_fournisseur_lignes
             (tiers_id, type_operation, document_id, document_numero,
              montant_debit, montant_credit, notes)
           VALUES ($1, 'facture', $2, $3, 0, $4, 'Solde initial importé Excel')`,
          [tiersId, invoiceId, numeroInterne, f.solde]
        );

        createdInvoices++;
        console.log(`  └─ facture solde initial: ${f.solde.toLocaleString()} (${numeroInterne})`);
      }
    }

    await client.query('COMMIT');
    console.log(`\n✓ Done. Tiers créés: ${createdTiers}, Factures solde initial: ${createdInvoices}, Skipped: ${skipped}`);
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
