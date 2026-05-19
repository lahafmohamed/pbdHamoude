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
// Check compte_client_lignes columns
const { rows: ccl } = await pool.query(
  `SELECT column_name, data_type, is_nullable
   FROM information_schema.columns
   WHERE table_name='compte_client_lignes'
   ORDER BY ordinal_position`
);
console.log('=== compte_client_lignes columns ===');
ccl.forEach(r => console.log(`  ${r.column_name}  ${r.data_type}  nullable=${r.is_nullable}`));

// Check constraints on acomptes_clients
const { rows: cons } = await pool.query(
  `SELECT conname, pg_get_constraintdef(oid) as def
   FROM pg_constraint
   WHERE conrelid = 'acomptes_clients'::regclass`
);
console.log('\n=== acomptes_clients constraints ===');
cons.forEach(r => console.log(`  ${r.conname}: ${r.def}`));

await pool.end();
