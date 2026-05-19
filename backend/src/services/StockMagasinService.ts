import pool from '../db/connection';

/**
 * StockMagasinService — single source of truth for the "magasin" stock scope.
 *
 * Sales rule (factures, devis):
 *   Only stock rows belonging to a magasin location are visible or sellable.
 *   Dépôt rows are excluded at SQL level.
 *
 * Magasin scope definition:
 *   stock_locations.actif = true
 *   AND NOT (
 *     UPPER(code) LIKE 'DEPOT%'
 *     OR UPPER(nom) LIKE '%DÉPÔT%'
 *     OR UPPER(nom) LIKE '%DEPOT%'
 *   )
 *
 * If a `type` column is added to stock_locations later, change MAGASIN_SCOPE_SQL only.
 */

// SQL fragment usable in WHERE clauses. Always reference stock_locations as `sl`.
export const MAGASIN_SCOPE_SQL = `(
  sl.actif = true
  AND NOT (
    UPPER(sl.code) LIKE 'DEPOT%'
    OR UPPER(sl.nom) LIKE '%DÉPÔT%'
    OR UPPER(sl.nom) LIKE '%DEPOT%'
  )
)`;

// Same predicate, but standalone (no alias) — for use against a raw stock_locations row.
const MAGASIN_SCOPE_SQL_STANDALONE = `(
  actif = true
  AND NOT (
    UPPER(code) LIKE 'DEPOT%'
    OR UPPER(nom) LIKE '%DÉPÔT%'
    OR UPPER(nom) LIKE '%DEPOT%'
  )
)`;

export const SALES_DEPOT_ERROR_MESSAGE =
  'Article non disponible à la vente — stock dépôt.';

export interface MagasinLocation {
  id: number;
  code: string;
  nom: string;
  est_principal: boolean;
}

/**
 * Returns the list of all active magasin location ids.
 * Used to build IN (...) filters for read endpoints.
 */
export async function getMagasinLocationIds(client?: any): Promise<number[]> {
  const runner = client || pool;
  const { rows } = await runner.query(
    `SELECT id FROM stock_locations WHERE ${MAGASIN_SCOPE_SQL_STANDALONE} ORDER BY id ASC`
  );
  return rows.map((r: any) => Number(r.id));
}

/**
 * Returns all active magasin locations (full rows).
 */
export async function getMagasinLocations(client?: any): Promise<MagasinLocation[]> {
  const runner = client || pool;
  const { rows } = await runner.query(
    `SELECT id, code, nom, est_principal
     FROM stock_locations
     WHERE ${MAGASIN_SCOPE_SQL_STANDALONE}
     ORDER BY est_principal DESC, id ASC`
  );
  return rows;
}

/**
 * Returns the default magasin location id (principal magasin if set,
 * otherwise the first active magasin by id). Throws if no magasin exists.
 */
export async function getDefaultMagasinLocationId(client?: any): Promise<number> {
  const runner = client || pool;
  const { rows } = await runner.query(
    `SELECT id FROM stock_locations
     WHERE ${MAGASIN_SCOPE_SQL_STANDALONE}
     ORDER BY est_principal DESC, id ASC
     LIMIT 1`
  );
  if (rows.length === 0) {
    throw new Error('Aucun magasin actif configuré pour les opérations de vente');
  }
  return Number(rows[0].id);
}

/**
 * Returns true iff the given location_id refers to an active magasin.
 * Used by write-path validation in factures/devis.
 */
export async function isMagasinLocationId(
  locationId: number | null | undefined,
  client?: any,
): Promise<boolean> {
  if (locationId === null || locationId === undefined) return false;
  const runner = client || pool;
  const { rows } = await runner.query(
    `SELECT 1 FROM stock_locations
     WHERE id = $1 AND ${MAGASIN_SCOPE_SQL_STANDALONE}
     LIMIT 1`,
    [locationId],
  );
  return rows.length > 0;
}

/**
 * Validates that locationId is a magasin and returns it; otherwise resolves
 * to the default magasin. Throws with French message if neither works.
 *
 * Use this from factures/devis create/update paths only.
 */
export async function resolveSalesLocationId(
  locationId: number | null | undefined,
  client?: any,
): Promise<number> {
  if (locationId !== null && locationId !== undefined) {
    const ok = await isMagasinLocationId(locationId, client);
    if (!ok) {
      const err: any = new Error(SALES_DEPOT_ERROR_MESSAGE);
      err.statusCode = 422;
      err.code = 'SALES_DEPOT_LOCATION';
      throw err;
    }
    return Number(locationId);
  }
  return getDefaultMagasinLocationId(client);
}

/**
 * For a list of {produit_id, location_id?} line items, returns indices that
 * reference a non-magasin (dépôt) stock row. Used to validate write payloads.
 *
 * Lines without an explicit location_id are validated against the resolved
 * sales location (passed as fallbackMagasinId).
 */
export async function findOffendingDepotLines(
  lines: Array<{ produit_id: number; location_id?: number | null }>,
  fallbackMagasinId: number,
  client?: any,
): Promise<Array<{ index: number; produit_id: number; reason: string }>> {
  const offending: Array<{ index: number; produit_id: number; reason: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const locId =
      ln.location_id === null || ln.location_id === undefined
        ? fallbackMagasinId
        : Number(ln.location_id);
    const ok = await isMagasinLocationId(locId, client);
    if (!ok) {
      offending.push({
        index: i,
        produit_id: Number(ln.produit_id),
        reason: 'depot_location',
      });
    }
  }
  return offending;
}

/**
 * Returns a SELECT query (and param array) producing the magasin-only stock view
 * for the products picker on Ventes pages.
 *
 * Result columns:
 *   id, reference, nom, description, categorie, prix_achat, prix_vente,
 *   stock (SUM across magasin locations only), stock_min, created_at, updated_at
 *
 * Caller is responsible for adding ORDER BY / LIMIT / OFFSET / extra filters.
 *
 * @param search optional substring on nom or reference
 * @param categorie optional categorie filter
 */
export function buildMagasinProductsQuery(opts: {
  search?: string;
  categorie?: string;
  locationId?: number;
}): { sql: string; params: any[] } {
  const params: any[] = [];
  let where = `p.deleted_at IS NULL`;
  let join = `
    LEFT JOIN stock_par_location spl ON spl.produit_id = p.id
    LEFT JOIN stock_locations sl ON sl.id = spl.location_id AND ${MAGASIN_SCOPE_SQL}
  `;

  if (opts.locationId !== undefined) {
    params.push(opts.locationId);
    join = `
      LEFT JOIN stock_par_location spl ON spl.produit_id = p.id AND spl.location_id = $${params.length}
      LEFT JOIN stock_locations sl ON sl.id = spl.location_id AND ${MAGASIN_SCOPE_SQL}
    `;
    where += ` AND $${params.length} IN (SELECT id FROM stock_locations WHERE ${MAGASIN_SCOPE_SQL_STANDALONE})`;
  }

  if (opts.search) {
    params.push(`%${opts.search}%`);
    const sIdx = params.length;
    where += ` AND (p.nom ILIKE $${sIdx} OR p.reference ILIKE $${sIdx})`;
  }
  if (opts.categorie) {
    params.push(opts.categorie);
    where += ` AND p.categorie = $${params.length}`;
  }

  // SUM only counts joined rows where sl matched the magasin predicate, so dépôt rows are excluded.
  const sql = `
    SELECT
      p.id, p.reference, p.nom, p.description, p.categorie,
      p.prix_achat, p.prix_vente,
      COALESCE(SUM(CASE WHEN sl.id IS NOT NULL THEN spl.quantite ELSE 0 END), 0) AS stock,
      p.stock_min, p.created_at, p.updated_at
    FROM produits p
    ${join}
    WHERE ${where}
    GROUP BY p.id
  `;

  return { sql, params };
}
