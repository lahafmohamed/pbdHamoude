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

async function seedData() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // ==========================================
    // PRODUITS INFORMATIQUE
    // ==========================================
    const produits = [
      // Ordinateurs Portables
      {
        reference: 'HP-PRO-450',
        nom: 'HP ProBook 450 G10',
        description: 'Ordinateur portable professionnel - Intel Core i5-1335U, 8Go RAM, 256Go SSD, écran 15.6" FHD, Windows 11 Pro',
        categorie: 'Ordinateurs Portables',
        prix_achat: 450000,
        prix_vente: 549000,
        stock: 15,
        stock_min: 5,
      },
      {
        reference: 'LEN-IDE-3',
        nom: 'Lenovo IdeaPad 3',
        description: 'Ordinateur portable polyvalent - AMD Ryzen 5 5500U, 8Go RAM, 512Go SSD, écran 15.6" HD, Windows 11',
        categorie: 'Ordinateurs Portables',
        prix_achat: 380000,
        prix_vente: 459000,
        stock: 20,
        stock_min: 5,
      },
      {
        reference: 'DELL-LAT-5540',
        nom: 'Dell Latitude 5540',
        description: 'Ultrabook professionnel - Intel Core i7-1355U, 16Go RAM, 512Go SSD, écran 15.6" FHD, Windows 11 Pro',
        categorie: 'Ordinateurs Portables',
        prix_achat: 620000,
        prix_vente: 749000,
        stock: 8,
        stock_min: 3,
      },
      {
        reference: 'ASUS-VIVO-15',
        nom: 'ASUS VivoBook 15',
        description: 'Ordinateur portable grand public - Intel Core i3-1215U, 8Go RAM, 256Go SSD, écran 15.6" FHD',
        categorie: 'Ordinateurs Portables',
        prix_achat: 290000,
        prix_vente: 349000,
        stock: 25,
        stock_min: 8,
      },
      {
        reference: 'ACER-ASP-3',
        nom: 'Acer Aspire 3',
        description: 'Ordinateur portable économique - AMD Athlon Silver, 4Go RAM, 128Go SSD, écran 15.6" HD',
        categorie: 'Ordinateurs Portables',
        prix_achat: 220000,
        prix_vente: 269000,
        stock: 30,
        stock_min: 10,
      },

      // Ordinateurs de Bureau
      {
        reference: 'HP-DESK-400',
        nom: 'HP ProDesk 400 G9',
        description: 'Ordinateur de bureau professionnel - Intel Core i5-12500, 8Go RAM, 256Go SSD, Windows 11 Pro',
        categorie: 'Ordinateurs de Bureau',
        prix_achat: 420000,
        prix_vente: 509000,
        stock: 12,
        stock_min: 4,
      },
      {
        reference: 'DELL-OPT-3000',
        nom: 'Dell OptiPlex 3000',
        description: 'PC de bureau compact - Intel Core i3-12100, 8Go RAM, 256Go SSD, Windows 11',
        categorie: 'Ordinateurs de Bureau',
        prix_achat: 350000,
        prix_vente: 425000,
        stock: 10,
        stock_min: 3,
      },

      // Écrans
      {
        reference: 'SAM-24-FHD',
        nom: 'Samsung Monitor 24" FHD',
        description: 'Écran LED Full HD 24 pouces, 75Hz, 5ms, HDMI/VGA, réglage hauteur',
        categorie: 'Écrans',
        prix_achat: 85000,
        prix_vente: 109000,
        stock: 35,
        stock_min: 10,
      },
      {
        reference: 'DELL-27-QHD',
        nom: 'Dell Monitor 27" QHD',
        description: 'Écran IPS Quad HD 27 pouces, 75Hz, USB-C, réglage hauteur pivot',
        categorie: 'Écrans',
        prix_achat: 165000,
        prix_vente: 199000,
        stock: 18,
        stock_min: 5,
      },
      {
        reference: 'LG-22-HD',
        nom: 'LG Monitor 22" HD',
        description: 'Écran LED HD 21.5 pouces, 75Hz, HDMI/VGA',
        categorie: 'Écrans',
        prix_achat: 65000,
        prix_vente: 79000,
        stock: 40,
        stock_min: 12,
      },

      // Imprimantes
      {
        reference: 'HP-LAS-M404',
        nom: 'HP LaserJet Pro M404dn',
        description: 'Imprimante laser monochrome, recto-verso automatique, réseau Ethernet, 38ppm',
        categorie: 'Imprimantes',
        prix_achat: 245000,
        prix_vente: 299000,
        stock: 8,
        stock_min: 3,
      },
      {
        reference: 'CAN-PIX-G3020',
        nom: 'Canon PIXMA G3020',
        description: 'Imprimante jet d\'encre multifunction avec réservoir intégré, WiFi, couleur',
        categorie: 'Imprimantes',
        prix_achat: 135000,
        prix_vente: 165000,
        stock: 15,
        stock_min: 5,
      },
      {
        reference: 'EPSON-L3250',
        nom: 'Epson EcoTank L3250',
        description: 'Imprimante multifunction avec réservoir intégré, WiFi, recto-verso manuel',
        categorie: 'Imprimantes',
        prix_achat: 155000,
        prix_vente: 189000,
        stock: 12,
        stock_min: 4,
      },

      // Réseaux
      {
        reference: 'TP-LINK-AX10',
        nom: 'TP-Link Archer AX10',
        description: 'Routeur WiFi 6 AX1500, double bande, 4 antennes, MU-MIMO',
        categorie: 'Réseaux',
        prix_achat: 45000,
        prix_vente: 59000,
        stock: 25,
        stock_min: 8,
      },
      {
        reference: 'TPL-SG108',
        nom: 'TP-Link TL-SG108',
        description: 'Switch réseau 8 ports Gigabit Ethernet, boîtier métal',
        categorie: 'Réseaux',
        prix_achat: 22000,
        prix_vente: 29000,
        stock: 30,
        stock_min: 10,
      },
      {
        reference: 'UBNT-AC-LR',
        nom: 'Ubiquiti UniFi AC LR',
        description: 'Point d\'accès WiFi professionnel AC1200, PoE, gestion centralisée',
        categorie: 'Réseaux',
        prix_achat: 68000,
        prix_vente: 85000,
        stock: 20,
        stock_min: 6,
      },

      // Périphériques
      {
        reference: 'LOG-MX-KEYS',
        nom: 'Logitech MX Keys',
        description: 'Clavier sans fil rétroéclairé, multi-dispositifs, USB-C',
        categorie: 'Périphériques',
        prix_achat: 65000,
        prix_vente: 79000,
        stock: 3,
        stock_min: 8,
      },
      {
        reference: 'LOG-MX-MASTER3',
        nom: 'Logitech MX Master 3S',
        description: 'Souris sans fil ergonomique, 8K DPI, USB-C, multi-dispositifs',
        categorie: 'Périphériques',
        prix_achat: 55000,
        prix_vente: 69000,
        stock: 15,
        stock_min: 5,
      },
      {
        reference: 'HP-WEBCAM-320',
        nom: 'HP Webcam HD 320',
        description: 'Caméra web HD 720p, microphone intégré, USB',
        categorie: 'Périphériques',
        prix_achat: 18000,
        prix_vente: 25000,
        stock: 40,
        stock_min: 15,
      },

      // Stockage
      {
        reference: 'SAND-SSD-500',
        nom: 'SanDisk SSD Plus 500Go',
        description: 'Disque SSD interne SATA III 500Go, lecture 500Mo/s',
        categorie: 'Stockage',
        prix_achat: 35000,
        prix_vente: 45000,
        stock: 50,
        stock_min: 15,
      },
      {
        reference: 'WD-HDD-1TB',
        nom: 'WD Elements HDD 1To',
        description: 'Disque dur externe portable 1To, USB 3.0',
        categorie: 'Stockage',
        prix_achat: 42000,
        prix_vente: 55000,
        stock: 35,
        stock_min: 10,
      },
      {
        reference: 'SAND-USB-64',
        nom: 'SanDisk Ultra USB 64Go',
        description: 'Clé USB 3.0 64Go, lecture 130Mo/s',
        categorie: 'Stockage',
        prix_achat: 5000,
        prix_vente: 8000,
        stock: 100,
        stock_min: 30,
      },

      // Logiciels
      {
        reference: 'MS-OFFICE-HB',
        nom: 'Microsoft Office Home & Business 2021',
        description: 'Suite bureautique complète - Word, Excel, PowerPoint, Outlook, licence perpétuelle',
        categorie: 'Logiciels',
        prix_achat: 125000,
        prix_vente: 159000,
        stock: 20,
        stock_min: 5,
      },
      {
        reference: 'WIN-11-PRO',
        nom: 'Windows 11 Pro',
        description: 'Licence Windows 11 Professionnel 64 bits, OEM',
        categorie: 'Logiciels',
        prix_achat: 85000,
        prix_vente: 109000,
        stock: 25,
        stock_min: 8,
      },
      {
        reference: 'KASP-SEC-2024',
        nom: 'Kaspersky Internet Security 2024',
        description: 'Antivirus 3 postes, 1 an, protection complète',
        categorie: 'Logiciels',
        prix_achat: 25000,
        prix_vente: 35000,
        stock: 40,
        stock_min: 15,
      },

      // Accessoires
      {
        reference: 'SAC-LAP-15',
        nom: 'Sac à dos Laptop 15.6"',
        description: 'Sac à dos rembourré pour ordinateur portable jusqu\'à 15.6", imperméable',
        categorie: 'Accessoires',
        prix_achat: 15000,
        prix_vente: 22000,
        stock: 45,
        stock_min: 15,
      },
      {
        reference: 'PARAS-600VA',
        nom: 'Parafondeur APC 600VA',
        description: 'Onduleur 600VA/360W, 6 prises, protection surtension',
        categorie: 'Accessoires',
        prix_achat: 45000,
        prix_vente: 59000,
        stock: 20,
        stock_min: 6,
      },
      {
        reference: 'HDMI-2M',
        nom: 'Câble HDMI 2.1 - 2m',
        description: 'Câble HDMI haute vitesse 4K@120Hz, 2 mètres',
        categorie: 'Accessoires',
        prix_achat: 5000,
        prix_vente: 9000,
        stock: 80,
        stock_min: 25,
      },
    ];

    console.log('📦 Insertion des produits...');
    for (const produit of produits) {
      await client.query(
        `INSERT INTO produits (reference, nom, description, categorie, prix_achat, prix_vente, stock, stock_min)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (reference) DO NOTHING`,
        [produit.reference, produit.nom, produit.description, produit.categorie, 
         produit.prix_achat, produit.prix_vente, produit.stock, produit.stock_min]
      );
    }
    console.log(`✅ ${produits.length} produits insérés`);

    // ==========================================
    // CLIENTS (CÔTE D'IVOIRE)
    // ==========================================
    const clients = [
      {
        nom: 'Kouamé',
        prenom: 'Jean-Baptiste',
        email: 'jb.kouame@gmail.com',
        telephone: '07 07 12 34 56',
        adresse: 'Cocody, Abidjan',
        nif: 'CI20230001234',
      },
      {
        nom: 'Traoré',
        prenom: 'Aminata',
        email: 'aminata.traore@entreprise.ci',
        telephone: '05 05 98 76 54',
        adresse: 'Plateau, Abidjan',
        nif: 'CI20230005678',
      },
      {
        nom: 'Koné',
        prenom: 'Moussa',
        email: 'moussa.kone@yahoo.fr',
        telephone: '07 08 11 22 33',
        adresse: 'Yopougon, Abidjan',
        nif: 'CI20230009012',
      },
      {
        nom: 'Adjé',
        prenom: 'Marie-Claire',
        email: 'mc.adje@business.ci',
        telephone: '05 06 44 55 66',
        adresse: 'Marcory, Abidjan',
        nif: 'CI20230003456',
      },
      {
        nom: 'Bamba',
        prenom: 'Ibrahim',
        email: 'ibrahim.bamba@gmail.com',
        telephone: '07 09 77 88 99',
        adresse: 'Treichville, Abidjan',
        nif: 'CI20230007890',
      },
      {
        nom: 'Touré',
        prenom: 'Fatoumata',
        email: 'fatoumata.toure@outlook.com',
        telephone: '05 07 22 33 44',
        adresse: 'Bouaké, Vallée du Bandama',
        nif: 'CI20230002345',
      },
      {
        nom: 'Dia',
        prenom: 'Seydou',
        email: 'seydou.dia@entreprise.ci',
        telephone: '07 10 55 66 77',
        adresse: 'Daloa, Haut-Sassandra',
        nif: 'CI20230006789',
      },
      {
        nom: 'Ouattara',
        prenom: 'Adama',
        email: 'adama.ouattara@gmail.com',
        telephone: '05 08 88 99 00',
        adresse: 'Korhogo, Poro',
        nif: 'CI20230004567',
      },
      {
        nom: 'Soro',
        prenom: 'Kafana',
        email: 'kafana.soro@yahoo.fr',
        telephone: '07 11 33 44 55',
        adresse: 'Man, Tonkpi',
        nif: 'CI20230008901',
      },
      {
        nom: 'Aké',
        prenom: 'Françoise',
        email: 'francoise.ake@business.ci',
        telephone: '05 09 66 77 88',
        adresse: 'San-Pédro, Bas-Sassandra',
        nif: 'CI20230001122',
      },
      {
        nom: 'Entreprise Ivoire Tech',
        prenom: '',
        email: 'contact@ivoiretech.ci',
        telephone: '27 22 45 67 89',
        adresse: 'Rue des Entrepreneurs, Plateau, Abidjan',
        nif: 'CI20230010000',
      },
      {
        nom: 'Société Digitale CI',
        prenom: '',
        email: 'info@digitaleci.com',
        telephone: '27 22 98 76 54',
        adresse: 'Zone Industrielle, Yopougon, Abidjan',
        nif: 'CI20230020000',
      },
    ];

    console.log('👥 Insertion des clients...');
    for (const cli of clients) {
      await client.query(
        `INSERT INTO clients (nom, prenom, email, telephone, adresse, nif)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [cli.nom, cli.prenom, cli.email, cli.telephone, cli.adresse, cli.nif]
      );
    }
    console.log(`✅ ${clients.length} clients insérés`);

    await client.query('COMMIT');
    console.log('\n🎉 Données de test insérées avec succès!');
    
    // Afficher un résumé
    const { rows: produitsCount } = await client.query('SELECT COUNT(*) FROM produits');
    const { rows: clientsCount } = await client.query('SELECT COUNT(*) FROM clients');
    
    console.log('\n📊 Résumé:');
    console.log(`   - Produits: ${produitsCount[0].count}`);
    console.log(`   - Clients: ${clientsCount[0].count}`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur lors de l\'insertion des données:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seedData().catch(console.error);
