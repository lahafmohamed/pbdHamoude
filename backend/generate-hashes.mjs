// Generate bcrypt hashes for default users
// Run this with: node generate-hashes.mjs
import bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 10;

async function generateHashes() {
  const adminHash = await bcrypt.hash('admin123', BCRYPT_ROUNDS);
  const managerHash = await bcrypt.hash('manager123', BCRYPT_ROUNDS);
  const caissierHash = await bcrypt.hash('caissier123', BCRYPT_ROUNDS);

  console.log('=== Default User Password Hashes ===');
  console.log('admin123  ->', adminHash);
  console.log('manager123 ->', managerHash);
  console.log('caissier123 ->', caissierHash);
  console.log('');
  console.log('=== SQL Insert Statements ===');
  console.log(`INSERT INTO utilisateurs (username, email, password_hash, nom_complet, role, actif)
VALUES ('admin', 'admin@magasin.local', '${adminHash}', 'Administrateur Systeme', 'admin', true)
ON CONFLICT (username) DO NOTHING;`);
  console.log('');
  console.log(`INSERT INTO utilisateurs (username, email, password_hash, nom_complet, role, actif)
VALUES ('manager', 'manager@magasin.local', '${managerHash}', 'Manager Magasin', 'manager', true)
ON CONFLICT (username) DO NOTHING;`);
  console.log('');
  console.log(`INSERT INTO utilisateurs (username, email, password_hash, nom_complet, role, actif)
VALUES ('caissier', 'caissier@magasin.local', '${caissierHash}', 'Caissier Magasin', 'caissier', true)
ON CONFLICT (username) DO NOTHING;`);
}

generateHashes();
