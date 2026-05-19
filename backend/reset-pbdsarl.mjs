// Wipe transactional data in pbdsarl, keep system ref tables.
// Seed admin user + depot principal + magasin pbdtreichville.
import pg from 'pg';
import bcrypt from 'bcrypt';

const { Pool } = pg;
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: '',
  database: 'pbdsarl',
});

const KEEP = new Set([
  'roles',
  'permissions',
  'role_permissions',
  'taux_tva',
  'plan_comptable',
  'categories_depenses',
]);

async function main() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public'"
    );
    const truncTables = rows
      .map((r) => r.tablename)
      .filter((t) => !KEEP.has(t));

    console.log('Truncating', truncTables.length, 'tables...');
    await client.query(
      `TRUNCATE TABLE ${truncTables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`
    );

    const adminRole = await client.query("SELECT id FROM roles WHERE nom='admin'");
    if (!adminRole.rows.length) throw new Error("Role 'admin' missing");
    const adminRoleId = adminRole.rows[0].id;

    const adminHash = await bcrypt.hash('admin123', 10);
    await client.query(
      `INSERT INTO utilisateurs (username, email, password_hash, nom_complet, role_id, actif, must_change_password)
       VALUES ($1, $2, $3, $4, $5, true, false)`,
      ['admin', 'admin@pbdsarl.local', adminHash, 'Administrateur PBD SARL', adminRoleId]
    );
    console.log('Admin user created (admin / admin123)');

    const depot = await client.query(
      `INSERT INTO stock_locations (code, nom, location_type, est_principal, actif)
       VALUES ('DEPOT01', 'Depot Principal PBD SARL', 'depot', true, true)
       RETURNING id`
    );
    const depotId = depot.rows[0].id;
    console.log('Depot principal created id=', depotId);

    const mag = await client.query(
      `INSERT INTO stock_locations (code, nom, location_type, est_principal, actif)
       VALUES ('MAG_TREICHVILLE', 'PBD Treichville', 'magasin', false, true)
       RETURNING id`
    );
    const magLocId = mag.rows[0].id;

    await client.query(
      `INSERT INTO magasins (location_id, code, nom, actif)
       VALUES ($1, 'PBDTREICHVILLE', 'PBD Treichville', true)`,
      [magLocId]
    );
    console.log('Magasin pbdtreichville created');

    console.log('\nDone. Login: admin / admin123');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
