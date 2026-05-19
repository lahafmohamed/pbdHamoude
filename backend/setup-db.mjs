import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function setupDatabase() {
  console.log('🔌 Connexion à PostgreSQL...');

  // Connection sans database spécifiée (postgres par défaut)
  const connection = new Pool({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: '',
    database: 'postgres',
  });

  try {
    // Vérifier si la DB existe déjà
    const { rows } = await connection.query(
      "SELECT datname FROM pg_database WHERE datname = 'magasin_db'"
    );

    if (rows.length === 0) {
      await connection.query('CREATE DATABASE magasin_db');
      console.log('✅ Base de données "magasin_db" créée');
    } else {
      console.log('ℹ️  Base de données "magasin_db" existe déjà');
    }

    await connection.end();

    // Se connecter à magasin_db
    const db = new Pool({
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: '',
      database: 'magasin_db',
    });

    // Lire et exécuter le schema SQL
    const schemaPath = path.join(__dirname, 'src', 'db', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    await db.query(schema);
    console.log('✅ Tables créées avec succès');

    // Vérifier les tables
    const { rows: tables } = await db.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
    );
    console.log('📋 Tables créées:');
    tables.forEach(t => console.log(`   - ${t.tablename}`));

    await db.end();
    console.log('\n🎉 Base de données prête!');
  } catch (error) {
    console.error('❌ Erreur:', error.message);
    process.exit(1);
  }
}

setupDatabase();
