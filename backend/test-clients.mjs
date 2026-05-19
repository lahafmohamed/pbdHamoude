// Test script to check database connection and clients table
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'magasin_db',
});

async function test() {
  try {
    console.log('Testing database connection...');
    console.log('Connection params:', {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      database: process.env.DB_NAME,
    });

    const client = await pool.connect();
    console.log('✅ Connected to PostgreSQL');

    // Test if clients table exists
    console.log('\nTesting clients table...');
    const { rows: tableCheck } = await client.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'clients')"
    );
    console.log('Clients table exists:', tableCheck[0].exists);

    if (tableCheck[0].exists) {
      // Check columns
      console.log('\nClients table columns:');
      const { rows: columns } = await client.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'clients' 
        ORDER BY ordinal_position
      `);
      columns.forEach(col => {
        console.log(`  - ${col.column_name}: ${col.data_type}`);
      });

      // Test the actual query
      console.log('\nTesting clients query...');
      const { rows, rowCount } = await client.query(
        'SELECT id, nom, prenom, email, telephone, adresse, nif, created_at, updated_at FROM clients WHERE deleted_at IS NULL ORDER BY nom ASC LIMIT 20 OFFSET 0'
      );
      console.log(`✅ Query successful! Returned ${rowCount} clients`);
    }

    client.release();
    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Error details:', error);
    process.exit(1);
  }
}

test();
