// Test direct du service CaisseMagasinService (utilise le code compilé dist)
const { caisseMagasinService } = require('./dist/services/CaisseMagasinService');

async function test() {
  try {
    console.log('--- Test 1: getSessionActive(1) ---');
    const session = await caisseMagasinService.getSessionActive(1);
    console.log('Résultat:', JSON.stringify(session, null, 2));

    console.log('\n--- Test 2: getUserMagasinRole(1, 1) ---');
    const role = await caisseMagasinService.getUserMagasinRole(1, 1);
    console.log('Role:', role);

    console.log('\n--- Test 3: getSessionDetail(3) ---');
    const detail = await caisseMagasinService.getSessionDetail(3);
    console.log('Detail:', JSON.stringify(detail, null, 2));
    
    console.log('\n--- Test 4: getMouvementsSession(3) ---');
    const mouvements = await caisseMagasinService.getMouvementsSession(3);
    console.log('Mouvements count:', mouvements.length);

    console.log('\n--- Test 5: getHistoriqueSessions ---');
    const hist = await caisseMagasinService.getHistoriqueSessions(1);
    console.log('Historique total:', hist.pagination.total);

    console.log('\n✅ Tous les tests ont réussi');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ ERREUR:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

test();
