// Test direct du service avec enregistrement mouvement
const { caisseMagasinService } = require('./dist/services/CaisseMagasinService');

async function test() {
  try {
    console.log('--- Test cloturerSession(4, 0, "test", 1) ---');
    const result = await caisseMagasinService.cloturerSession({
      session_id: 4,
      fond_final_compte: 0,
      commentaire_cloture: 'test cloture',
      user_id: 1
    });
    console.log('Result:', JSON.stringify(result, null, 2));
    console.log('\n✅ OK');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ ERR:', err.message);
    process.exit(1);
  }
}
test();
