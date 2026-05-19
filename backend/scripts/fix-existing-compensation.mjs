import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'magasin_db',
});

const client = await pool.connect();
try {
  await client.query('BEGIN');

  // For each existing compensation that has no matching acompte, create one
  const { rows: comps } = await client.query(
    `SELECT c.* FROM compensations c
     WHERE c.statut = 'valide'
     AND NOT EXISTS (
       SELECT 1 FROM acomptes_clients a
       WHERE a.tiers_id = c.tiers_id
         AND a.methode_paiement = 'compensation'
         AND a.montant = c.montant
         AND DATE(a.date_acompte) = DATE(c.date_compensation)
     )`
  );

  console.log(`Found ${comps.length} compensation(s) without matching acompte`);

  for (const comp of comps) {
    const pieceNum = `COMP-${comp.tiers_id}-FIX`;
    const { rows } = await client.query(
      `INSERT INTO acomptes_clients
         (tiers_id, montant, montant_restant, methode_paiement, notes, date_acompte)
       VALUES ($1, $2, $2, 'compensation', $3, $4) RETURNING id`,
      [comp.tiers_id, comp.montant, `Compensation ${pieceNum} (fix)`, comp.date_compensation]
    );
    console.log(`Created acompte id=${rows[0].id} for compensation id=${comp.id}, tiers=${comp.tiers_id}, montant=${comp.montant}`);
  }

  await client.query('COMMIT');
  console.log('Transaction committed');

  // Now recompute FIFO for affected tiers
  const tiersList = [...new Set(comps.map(c => c.tiers_id))];
  for (const tiersId of tiersList) {
    console.log(`\nRecomputing FIFO for tiers ${tiersId}...`);
    
    // Manual FIFO recompute
    const { rows: factures } = await pool.query(
      `SELECT id, total, statut, date_facture FROM factures
       WHERE tiers_id = $1 AND statut != 'annulee' AND deleted_at IS NULL
       ORDER BY date_facture ASC, id ASC`,
      [tiersId]
    );
    const { rows: acomptes } = await pool.query(
      `SELECT id, montant, date_acompte FROM acomptes_clients
       WHERE tiers_id = $1 AND statut = 'disponible'
       ORDER BY date_acompte ASC, id ASC`,
      [tiersId]
    );
    const { rows: paiements } = await pool.query(
      `SELECT p.id, p.montant, p.date_paiement FROM paiements p
       JOIN factures f ON f.id = p.facture_id
       WHERE f.tiers_id = $1 AND f.deleted_at IS NULL
       ORDER BY p.date_paiement ASC, p.id ASC`,
      [tiersId]
    );

    const funds = [
      ...paiements.map(p => ({ id: p.id, montant: parseFloat(p.montant), date: p.date_paiement, type: 'paiement', remaining: parseFloat(p.montant) })),
      ...acomptes.map(a => ({ id: a.id, montant: parseFloat(a.montant), date: a.date_acompte, type: 'acompte', remaining: parseFloat(a.montant) })),
    ].sort((a, b) => new Date(a.date) - new Date(b.date) || a.id - b.id);

    console.log(`  Factures: ${factures.length}, Funds total: ${funds.reduce((s,f) => s+f.montant, 0)}`);

    for (const facture of factures) {
      let allocated = 0;
      const total = parseFloat(facture.total);
      for (const fund of funds) {
        if (fund.remaining <= 0 || allocated >= total) break;
        const toAlloc = Math.min(fund.remaining, total - allocated);
        fund.remaining -= toAlloc;
        allocated += toAlloc;
        if (fund.type === 'acompte') {
          await pool.query(
            `UPDATE acomptes_clients SET statut='utilise', facture_id_applique=$1, date_utilisation=NOW() WHERE id=$2`,
            [facture.id, fund.id]
          );
        }
      }
      const newStatut = allocated <= 0 ? 'en_attente' : allocated < total ? 'partielle' : 'payee';
      await pool.query(
        `UPDATE factures SET montant_paye=$1, remaining_due=$2, statut=$3 WHERE id=$4`,
        [allocated, total - allocated, newStatut, facture.id]
      );
      console.log(`  Facture ${facture.id}: montant_paye=${allocated}, statut=${newStatut}`);
    }
  }

  console.log('\n✅ Done');
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('❌ Error:', err.message);
} finally {
  client.release();
  await pool.end();
}
