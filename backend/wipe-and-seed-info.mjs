#!/usr/bin/env node
/**
 * wipe-and-seed-info.mjs
 * Wipes transactional + tiers + produits, seeds informatique-themed data.
 * KEEPS: utilisateurs, magasins, stock_locations, categories_depenses,
 *        taux_tva, plan_comptable, periodes_comptables, caisses (config).
 */

import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'magasin_db',
});

const TABLES_TO_WIPE = [
  // Transactional — children first via CASCADE handles order
  'acompte_applications',
  'acompte_applications_fournisseur',
  'acomptes_clients',
  'acomptes_fournisseur',
  'allocation_audit',
  'audit_log',
  'barcode_scans',
  'bon_livraison_lignes',
  'bons_livraison',
  'commande_lignes',
  'commandes_fournisseur',
  'compensations',
  'compte_client_lignes',
  'compte_fournisseur_lignes',
  'demandes_reapprovisionnement_lignes',
  'demandes_reapprovisionnement_history',
  'demandes_reapprovisionnement',
  'depenses',
  'devis_lignes',
  'devis',
  'document_lignes',
  'ecritures_comptables',
  'facture_avoir_lignes',
  'facture_fournisseur_lignes',
  'factures_avoir',
  'factures_fournisseur',
  'factures',
  'internal_stock_request_lignes',
  'internal_stock_requests',
  'lots',
  'mouvements_caisse',
  'mouvements_stock',
  'numeros_serie',
  'paiements',
  'paiements_fournisseur',
  'pos_cart_items',
  'pos_sessions',
  'reception_lignes',
  'receptions',
  'retour_lignes',
  'retours',
  'sessions_caisse',
  'stock_par_location',
  'stock_transfer_lignes',
  'stock_transfers',
  'three_way_match_details',
  'three_way_matches',
  'transferts_caisse',
  // Master data also wiped per scope
  'produits',
  'tiers',
];

const PRODUITS = [
  ['INF-LAP-001', 'Laptop HP ProBook 450 G10', 'i5-1335U, 16GB, 512GB SSD, 15.6"', 'Laptops',     450000, 595000, 8],
  ['INF-LAP-002', 'Laptop Dell Latitude 5440', 'i7-1365U, 16GB, 1TB SSD, 14"',     'Laptops',     620000, 795000, 5],
  ['INF-LAP-003', 'MacBook Air M3 13"',         'Apple M3, 8GB, 256GB',             'Laptops',     720000, 895000, 3],
  ['INF-DSK-001', 'Desktop HP EliteDesk 800 G9','i7-13700, 32GB, 1TB SSD',          'Desktops',    580000, 740000, 4],
  ['INF-MON-001', 'Écran Dell 24" P2422H',      '1920x1080 IPS 60Hz',               'Écrans',      95000,  135000, 12],
  ['INF-MON-002', 'Écran LG UltraGear 27"',     '2560x1440 IPS 165Hz',              'Écrans',      180000, 245000, 6],
  ['INF-KBD-001', 'Clavier Logitech MX Keys',   'Sans fil, rétroéclairé AZERTY',    'Périphériques', 55000, 79000, 20],
  ['INF-KBD-002', 'Clavier Logitech K120',      'Filaire USB AZERTY',               'Périphériques', 6000,  9500,  50],
  ['INF-MSE-001', 'Souris Logitech MX Master 3','Sans fil rechargeable',            'Périphériques', 48000, 69000, 25],
  ['INF-MSE-002', 'Souris Logitech B100',       'Filaire USB',                      'Périphériques', 3000,  5000,  80],
  ['INF-STO-001', 'SSD Samsung 980 Pro 1TB',    'NVMe PCIe 4.0',                    'Stockage',    65000,  89000, 18],
  ['INF-STO-002', 'SSD WD Green 480GB SATA',    '2.5" SATA III',                    'Stockage',    22000,  32000, 30],
  ['INF-RAM-001', 'RAM Corsair Vengeance 16GB DDR4','3200MHz CL16',                  'Composants',  28000,  42000, 15],
  ['INF-RAM-002', 'RAM Kingston Fury 32GB DDR5','5600MHz CL36 Kit 2x16',            'Composants',  72000,  98000, 10],
  ['INF-PRT-001', 'Imprimante HP LaserJet Pro M404dn','Mono A4 réseau',             'Imprimantes', 165000, 215000, 6],
  ['INF-PRT-002', 'Imprimante Epson EcoTank L3250','Couleur multifonction Wi-Fi',   'Imprimantes', 130000, 175000, 4],
  ['INF-CBL-001', 'Câble HDMI 2.1 2m',          '4K 120Hz / 8K 60Hz',               'Accessoires',  3500,   6500,  100],
  ['INF-CBL-002', 'Câble USB-C 1m PD 100W',     'Charge rapide + data',             'Accessoires',  4000,   7500,  80],
  ['INF-NET-001', 'Routeur TP-Link Archer AX55','Wi-Fi 6 AX3000 dual-band',         'Réseau',      55000,  79000, 12],
  ['INF-NET-002', 'Switch TP-Link 8 ports Giga','TL-SG108 non managé',              'Réseau',      18000,  28000, 18],
];

const TIERS = [
  // Clients
  { code: 'CLI-001', raison_sociale: 'KONÉ Aboubacar',           prenom: 'Aboubacar', est_client: true,  est_fournisseur: false, telephone: '+22507010101', email: 'akone@particulier.ci',     credit_max: 0,        nif: null,           rccm: null },
  { code: 'CLI-002', raison_sociale: 'SARL TechAvenir',          prenom: null,        est_client: true,  est_fournisseur: false, telephone: '+22527230000', email: 'compta@techavenir.ci',     credit_max: 3000000,  nif: 'CI-NIF-22456', rccm: 'CI-ABJ-2019-B-1234' },
  { code: 'CLI-003', raison_sociale: 'Cabinet Cygnus Consulting',prenom: null,        est_client: true,  est_fournisseur: false, telephone: '+22521445566', email: 'achat@cygnus.ci',          credit_max: 5000000,  nif: 'CI-NIF-99887', rccm: 'CI-ABJ-2020-B-5678' },
  // Fournisseurs
  { code: 'FRN-001', raison_sociale: 'HP Côte d\'Ivoire SA',     prenom: null,        est_client: false, est_fournisseur: true,  telephone: '+22520301010', email: 'commercial@hp-ci.com',     credit_max: 0,        nif: 'CI-NIF-11122', rccm: 'CI-ABJ-2010-B-0001' },
  { code: 'FRN-002', raison_sociale: 'Dell Distribution WAFR',   prenom: null,        est_client: false, est_fournisseur: true,  telephone: '+22520302020', email: 'orders@dell-wafr.com',     credit_max: 0,        nif: 'CI-NIF-33344', rccm: 'CI-ABJ-2015-B-0002' },
  { code: 'FRN-003', raison_sociale: 'AccessoiresPro Distrib',   prenom: null,        est_client: false, est_fournisseur: true,  telephone: '+22520303030', email: 'ventes@accpro.ci',         credit_max: 0,        nif: 'CI-NIF-55566', rccm: 'CI-ABJ-2018-B-0003' },
  // Mixed (client + fournisseur)
  { code: 'MIX-001', raison_sociale: 'CompuServices SARL',       prenom: null,        est_client: true,  est_fournisseur: true,  telephone: '+22527990099', email: 'contact@compuserv.ci',     credit_max: 1500000,  nif: 'CI-NIF-77788', rccm: 'CI-ABJ-2021-B-0099' },
];

async function main() {
  const client = await pool.connect();
  try {
    const { rows: dbInfo } = await client.query(
      `SELECT current_database() AS db, current_user AS usr, inet_server_addr()::text AS host`
    );
    console.log(`Target DB: ${dbInfo[0].db}@${dbInfo[0].host || 'local'} as ${dbInfo[0].usr}`);

    await client.query('BEGIN');

    // 1. WIPE
    const list = TABLES_TO_WIPE.join(', ');
    console.log(`\nWipe ${TABLES_TO_WIPE.length} tables (TRUNCATE RESTART IDENTITY CASCADE)...`);
    await client.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    console.log('  ✓ wipe done');

    // 2. SEED PRODUITS (+ stock_par_location for proper inventory display)
    console.log(`\nSeeding ${PRODUITS.length} produits informatique...`);
    const { rows: locRows } = await client.query(
      `SELECT id FROM stock_locations WHERE est_principal = TRUE ORDER BY id LIMIT 1`
    );
    const primaryLocId = locRows[0]?.id;
    if (!primaryLocId) throw new Error('Aucune stock_location principale — seed magasins/locations d\'abord');

    for (const [ref, nom, desc, cat, pa, pv, stk] of PRODUITS) {
      const { rows: pRows } = await client.query(
        `INSERT INTO produits (reference, nom, description, categorie, prix_achat, prix_vente, stock, stock_min)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [ref, nom, desc, cat, pa, pv, stk, 3]
      );
      await client.query(
        `INSERT INTO stock_par_location (produit_id, location_id, quantite)
         VALUES ($1,$2,$3)
         ON CONFLICT (produit_id, location_id)
         DO UPDATE SET quantite = EXCLUDED.quantite, updated_at = CURRENT_TIMESTAMP`,
        [pRows[0].id, primaryLocId, stk]
      );
    }
    console.log(`  ✓ ${PRODUITS.length} produits insérés + stock_par_location synced (location ${primaryLocId})`);

    // 3. SEED TIERS
    console.log(`\nSeeding ${TIERS.length} tiers...`);
    for (const t of TIERS) {
      await client.query(
        `INSERT INTO tiers (code, raison_sociale, prenom, est_client, est_fournisseur,
                            telephone, email, credit_max, nif, rccm)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [t.code, t.raison_sociale, t.prenom, t.est_client, t.est_fournisseur,
         t.telephone, t.email, t.credit_max, t.nif, t.rccm]
      );
    }
    console.log(`  ✓ ${TIERS.length} tiers insérés (${TIERS.filter(t=>t.est_client).length} clients, ${TIERS.filter(t=>t.est_fournisseur).length} fournisseurs)`);

    await client.query('COMMIT');

    // Verify
    const { rows: c1 } = await client.query('SELECT COUNT(*)::int FROM produits');
    const { rows: c2 } = await client.query('SELECT COUNT(*)::int FROM tiers');
    const { rows: c3 } = await client.query('SELECT COUNT(*)::int FROM factures');
    const { rows: c4 } = await client.query('SELECT COUNT(*)::int FROM mouvements_caisse');
    const { rows: c5 } = await client.query('SELECT COUNT(*)::int FROM utilisateurs');
    const { rows: c6 } = await client.query('SELECT COUNT(*)::int FROM magasins');

    console.log('\n=== Post-wipe counts ===');
    console.log(`  produits          : ${c1[0].count}  (seeded)`);
    console.log(`  tiers             : ${c2[0].count}  (seeded)`);
    console.log(`  factures          : ${c3[0].count}  (wiped)`);
    console.log(`  mouvements_caisse : ${c4[0].count}  (wiped)`);
    console.log(`  utilisateurs      : ${c5[0].count}  (kept)`);
    console.log(`  magasins          : ${c6[0].count}  (kept)`);
    console.log('\n✅ Done');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ ERROR:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
