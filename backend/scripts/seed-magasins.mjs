import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env
const envPath = join(__dirname, '..', '.env');
const envContent = readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) env[match[1]] = match[2].replace(/["']/g, '');
}

const pool = new pg.Pool({
  host: env.DB_HOST || 'localhost',
  port: parseInt(env.DB_PORT || '5432'),
  database: env.DB_NAME || 'magasin_db',
  user: env.DB_USER || 'postgres',
  password: env.DB_PASSWORD || 'postgres',
});

async function seed() {
  try {
    // Check existing
    const { rows: existing } = await pool.query('SELECT * FROM magasins');
    console.log('Existing magasins:', existing);
    
    if (existing.length === 0) {
      // Check stock_locations
      const { rows: locations } = await pool.query(
        "SELECT * FROM stock_locations WHERE location_type = 'magasin' OR est_principal = false LIMIT 1"
      );
      console.log('Found locations:', locations);
      
      if (locations.length > 0) {
        await pool.query(
          'INSERT INTO magasins (location_id, code, nom, actif) VALUES ($1, $2, $3, true)',
          [locations[0].id, locations[0].code || 'MAG01', locations[0].nom || 'Magasin Principal']
        );
      } else {
        await pool.query(
          "INSERT INTO magasins (code, nom, actif) VALUES ('MAG01', 'Magasin Principal', true)"
        );
      }
      
      const { rows: verify } = await pool.query('SELECT * FROM magasins');
      console.log('Created magasin:', verify);
    }
    
    console.log('Done!');
    await pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    await pool.end();
    process.exit(1);
  }
}

seed();
