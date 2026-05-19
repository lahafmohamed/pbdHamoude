// Read-only audit: list factures and devis whose location_id points at a dépôt,
// or whose lines reference a product that has NO magasin stock row at all.
//
// Run:  node scripts/audit-sales-depot-history.mjs
// Outputs JSON to stdout. Mutates nothing.

import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'magasin_db',
});

const DEPOT_PREDICATE = `(
  UPPER(sl.code) LIKE 'DEPOT%'
  OR UPPER(sl.nom) LIKE '%DÉPÔT%'
  OR UPPER(sl.nom) LIKE '%DEPOT%'
)`;

async function main() {
  // --- Factures whose own location_id is a dépôt ---
  const facturesByLocation = await pool.query(`
    SELECT f.id, f.numero_facture, f.date_facture,
           c.nom AS client_nom, c.prenom AS client_prenom,
           sl.id AS location_id, sl.code AS location_code, sl.nom AS location_nom
    FROM factures f
    JOIN stock_locations sl ON sl.id = f.location_id
    LEFT JOIN clients c ON c.id = f.client_id
    WHERE f.deleted_at IS NULL
      AND ${DEPOT_PREDICATE}
    ORDER BY f.date_facture DESC
  `);

  // --- Devis whose own location_id is a dépôt ---
  const devisByLocation = await pool.query(`
    SELECT d.id, d.numero_devis, d.date_devis,
           c.nom AS client_nom, c.prenom AS client_prenom,
           sl.id AS location_id, sl.code AS location_code, sl.nom AS location_nom
    FROM devis d
    JOIN stock_locations sl ON sl.id = d.location_id
    LEFT JOIN clients c ON c.id = d.client_id
    WHERE ${DEPOT_PREDICATE}
    ORDER BY d.date_devis DESC
  `);

  // --- Factures with at least one line referencing a product that has NO
  //     magasin stock row (i.e. only ever existed in dépôt) ---
  const facturesByLines = await pool.query(`
    WITH magasin_locations AS (
      SELECT id FROM stock_locations sl
      WHERE sl.actif = true AND NOT ${DEPOT_PREDICATE}
    ),
    product_has_magasin AS (
      SELECT DISTINCT spl.produit_id
      FROM stock_par_location spl
      WHERE spl.location_id IN (SELECT id FROM magasin_locations)
    ),
    offending_lines AS (
      SELECT dl.document_id AS facture_id, dl.produit_id, p.nom AS produit_nom, p.reference AS produit_ref
      FROM document_lignes dl
      JOIN produits p ON p.id = dl.produit_id
      WHERE dl.document_type = 'facture'
        AND dl.produit_id IS NOT NULL
        AND dl.produit_id NOT IN (SELECT produit_id FROM product_has_magasin)
    )
    SELECT f.id, f.numero_facture, f.date_facture,
           c.nom AS client_nom, c.prenom AS client_prenom,
           json_agg(json_build_object(
             'produit_id', ol.produit_id,
             'reference', ol.produit_ref,
             'nom', ol.produit_nom
           )) AS offending_products
    FROM factures f
    JOIN offending_lines ol ON ol.facture_id = f.id
    LEFT JOIN clients c ON c.id = f.client_id
    WHERE f.deleted_at IS NULL
    GROUP BY f.id, f.numero_facture, f.date_facture, c.nom, c.prenom
    ORDER BY f.date_facture DESC
  `);

  const devisByLines = await pool.query(`
    WITH magasin_locations AS (
      SELECT id FROM stock_locations sl
      WHERE sl.actif = true AND NOT ${DEPOT_PREDICATE}
    ),
    product_has_magasin AS (
      SELECT DISTINCT spl.produit_id
      FROM stock_par_location spl
      WHERE spl.location_id IN (SELECT id FROM magasin_locations)
    ),
    offending_lines AS (
      SELECT dl.document_id AS devis_id, dl.produit_id, p.nom AS produit_nom, p.reference AS produit_ref
      FROM document_lignes dl
      JOIN produits p ON p.id = dl.produit_id
      WHERE dl.document_type = 'devis'
        AND dl.produit_id IS NOT NULL
        AND dl.produit_id NOT IN (SELECT produit_id FROM product_has_magasin)
    )
    SELECT d.id, d.numero_devis, d.date_devis,
           c.nom AS client_nom, c.prenom AS client_prenom,
           json_agg(json_build_object(
             'produit_id', ol.produit_id,
             'reference', ol.produit_ref,
             'nom', ol.produit_nom
           )) AS offending_products
    FROM devis d
    JOIN offending_lines ol ON ol.devis_id = d.id
    LEFT JOIN clients c ON c.id = d.client_id
    GROUP BY d.id, d.numero_devis, d.date_devis, c.nom, c.prenom
    ORDER BY d.date_devis DESC
  `);

  const report = {
    generated_at: new Date().toISOString(),
    summary: {
      factures_with_depot_location: facturesByLocation.rowCount,
      devis_with_depot_location: devisByLocation.rowCount,
      factures_with_depot_only_products: facturesByLines.rowCount,
      devis_with_depot_only_products: devisByLines.rowCount,
    },
    factures_with_depot_location: facturesByLocation.rows,
    devis_with_depot_location: devisByLocation.rows,
    factures_with_depot_only_products: facturesByLines.rows,
    devis_with_depot_only_products: devisByLines.rows,
  };

  console.log(JSON.stringify(report, null, 2));
  await pool.end();
}

main().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
