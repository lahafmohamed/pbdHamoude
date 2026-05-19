// Reproduce exact payment flow
const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ host: process.env.DB_HOST || 'localhost', port: parseInt(process.env.DB_PORT || '5432'), user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'magasin_db' });

async function test() {
  const client = await pool.connect();
  try {
    const factureId = 1;
    const montant = 1000;
    const methode_paiement = 'espece';
    const notes = '';

    console.log('Step 1: Get facture');
    const { rows: factureRows } = await client.query('SELECT tiers_id, statut, location_id FROM factures WHERE id = $1', [factureId]);
    console.log(factureRows);

    console.log('\nStep 2: Find magasin by location');
    const locationId = factureRows[0].location_id;
    console.log('location_id:', locationId);

    const { rows: magRows } = await client.query('SELECT id FROM magasins WHERE location_id = $1 LIMIT 1', [locationId]);
    console.log('magasins:', magRows);

    console.log('\nStep 3: Find active session');
    const { rows: sessRows } = await client.query(
      'SELECT id FROM sessions_caisse WHERE magasin_id = $1 AND statut = $2 LIMIT 1',
      [magRows[0].id, 'ouverte']
    );
    console.log('sessions:', sessRows);

    const effectiveSessionCaisseId = sessRows[0]?.id || null;
    console.log('session_caisse_id:', effectiveSessionCaisseId);

    console.log('\nStep 4: Insert paiement');
    const { rows: paiementResult } = await client.query(
      `INSERT INTO paiements (facture_id, montant, methode_paiement, date_paiement, reference, notes, session_caisse_id, magasin_id)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, $5, $6, (SELECT m.id FROM factures f JOIN magasins m ON m.location_id = f.location_id WHERE f.id = $1 LIMIT 1))
       RETURNING id, date_paiement`,
      [factureId, montant, methode_paiement, null, notes || null, effectiveSessionCaisseId]
    );
    console.log('paiement inserted:', paiementResult[0]);

    // Step 5: test enregistrerMouvement from dist
    const { caisseMagasinService } = require('./dist/services/CaisseMagasinService');
    if (methode_paiement === 'espece' && effectiveSessionCaisseId) {
      console.log('\nStep 5: enregistrerMouvement');
      await caisseMagasinService.enregistrerMouvement(client, {
        session_caisse_id: effectiveSessionCaisseId,
        type: 'encaissement',
        categorie: 'paiement_client',
        montant,
        reference_type: 'paiement',
        reference_id: paiementResult[0].id,
        libelle: `Paiement facture #${factureId} — ${notes || ''}`.trim(),
        user_id: undefined,
      });
      console.log('✅ mouvement registered');
    }

    // rollback
    await client.query('ROLLBACK');
    console.log('\n✅ All steps succeeded (rolled back for test)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ ERROR:', err.message);
    console.error(err.stack);
  } finally {
    client.release();
    await pool.end();
  }
}
test();
