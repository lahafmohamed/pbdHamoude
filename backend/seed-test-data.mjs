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

async function seedTestData() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ==========================================
    // PRODUITS avec stock = 0 (pour tester les alertes stock, réceptions, etc.)
    // ==========================================
    const produits = [
      {
        reference: 'TEST-LAPTOP-001',
        nom: 'Laptop Test - HP Pavilion 15',
        description: 'Produit de test - Intel Core i5, 8Go RAM, 512Go SSD',
        categorie: 'Ordinateurs Portables',
        prix_achat: 350000,
        prix_vente: 420000,
        stock: 0,
        stock_min: 5,
      },
      {
        reference: 'TEST-MONITOR-001',
        nom: 'Écran Test - Dell 24"',
        description: 'Produit de test - Écran Full HD 24 pouces, HDMI',
        categorie: 'Écrans',
        prix_achat: 90000,
        prix_vente: 115000,
        stock: 0,
        stock_min: 3,
      },
      {
        reference: 'TEST-PRINTER-001',
        nom: 'Imprimante Test - Brother HL-L2310D',
        description: 'Produit de test - Imprimante laser monochrome recto-verso',
        categorie: 'Imprimantes',
        prix_achat: 120000,
        prix_vente: 155000,
        stock: 0,
        stock_min: 2,
      },
      {
        reference: 'TEST-KEYBOARD-001',
        nom: 'Clavier Test - Logitech K120',
        description: 'Produit de test - Clavier filaire USB, AZERTY',
        categorie: 'Périphériques',
        prix_achat: 8000,
        prix_vente: 12000,
        stock: 0,
        stock_min: 10,
      },
      {
        reference: 'TEST-USB-001',
        nom: 'Clé USB Test - SanDisk 32Go',
        description: 'Produit de test - Clé USB 3.0 32Go',
        categorie: 'Stockage',
        prix_achat: 3000,
        prix_vente: 5000,
        stock: 0,
        stock_min: 20,
      },
    ];

    console.log('📦 Insertion des produits de test (stock=0)...');
    let produitsInseres = 0;
    for (const produit of produits) {
      const result = await client.query(
        `INSERT INTO produits (reference, nom, description, categorie, prix_achat, prix_vente, stock, stock_min)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (reference) DO UPDATE SET
           nom = EXCLUDED.nom,
           stock = EXCLUDED.stock,
           stock_min = EXCLUDED.stock_min
         RETURNING id`,
        [produit.reference, produit.nom, produit.description, produit.categorie,
         produit.prix_achat, produit.prix_vente, produit.stock, produit.stock_min]
      );
      if (result.rows.length > 0) produitsInseres++;
    }
    console.log(`✅ ${produitsInseres} produits de test insérés/mis à jour`);

    // ==========================================
    // CLIENTS (tiers) avec solde = 0 (compte vierge pour tester)
    // ==========================================
    const tiers = [
      {
        code: 'TST-CLI-001',
        raison_sociale: 'Client Test Alpha',
        prenom: 'Alpha',
        email: 'test.alpha@test.ci',
        telephone: '07 00 00 00 01',
        adresse: 'Cocody, Abidjan',
        nif: 'TEST00000001',
      },
      {
        code: 'TST-CLI-002',
        raison_sociale: 'Client Test Bêta',
        prenom: 'Bêta',
        email: 'test.beta@test.ci',
        telephone: '07 00 00 00 02',
        adresse: 'Plateau, Abidjan',
        nif: 'TEST00000002',
      },
      {
        code: 'TST-CLI-003',
        raison_sociale: 'Client Test Gamma',
        prenom: 'Gamma',
        email: 'test.gamma@test.ci',
        telephone: '07 00 00 00 03',
        adresse: 'Yopougon, Abidjan',
        nif: 'TEST00000003',
      },
      {
        code: 'TST-CLI-004',
        raison_sociale: 'Entreprise Test SARL',
        prenom: null,
        email: 'contact@entreprise-test.ci',
        telephone: '27 00 00 00 04',
        adresse: 'Zone Industrielle, Abidjan',
        nif: 'TEST00000004',
      },
    ];

    console.log('👥 Insertion des clients de test dans tiers (solde=0)...');
    let clientsInseres = 0;
    for (const t of tiers) {
      const result = await client.query(
        `INSERT INTO tiers (code, raison_sociale, prenom, email, telephone, adresse, nif,
                            est_client, est_fournisseur,
                            solde_client_actuel, acompte_client_disponible)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, false, 0, 0)
         ON CONFLICT (code) DO NOTHING
         RETURNING id`,
        [t.code, t.raison_sociale, t.prenom, t.email, t.telephone, t.adresse, t.nif]
      );
      if (result.rows.length > 0) clientsInseres++;
    }
    console.log(`✅ ${clientsInseres} clients de test insérés`);

    await client.query('COMMIT');
    console.log('\n🎉 Données de test insérées avec succès!');

    // Résumé
    const { rows: produitsTest } = await client.query(
      `SELECT COUNT(*) FROM produits WHERE reference LIKE 'TEST-%'`
    );
    const { rows: clientsTest } = await client.query(
      `SELECT COUNT(*) FROM tiers WHERE code LIKE 'TST-CLI-%' AND est_client = true`
    );
    const { rows: stockZero } = await client.query(
      `SELECT COUNT(*) FROM produits WHERE stock = 0`
    );

    console.log('\n📊 Résumé données de test:');
    console.log(`   - Produits TEST insérés : ${produitsTest[0].count}`);
    console.log(`   - Clients TEST insérés  : ${clientsTest[0].count}`);
    console.log(`   - Total produits stock=0: ${stockZero[0].count}`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur lors de l\'insertion des données de test:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seedTestData().catch(console.error);
