import pool from '../db/connection';
import { BaseService, PaginatedResult, PaginationParams } from './BaseService';

export interface ProduitRecord {
  id: number;
  reference: string;
  nom: string;
  description: string | null;
  categorie: string | null;
  prix_achat: string;
  prix_vente: string;
  stock: number;
  stock_min: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CreateProduitInput {
  reference: string;
  nom: string;
  description?: string;
  categorie?: string;
  prix_achat: number;
  prix_vente: number;
  stock?: number;
  stock_min?: number;
  location_id?: number;
  initial_stock?: number;
  cree_par?: number;
}

export interface UpdateProduitInput {
  reference?: string;
  nom?: string;
  description?: string;
  categorie?: string;
  prix_achat?: number;
  prix_vente?: number;
  stock?: number;
  stock_min?: number;
  modifie_par?: number;
}

export class ProduitService extends BaseService<ProduitRecord> {
  protected tableName = 'produits';
  protected selectColumns = 'id, reference, nom, description, categorie, prix_achat, prix_vente, stock, stock_min, created_at, updated_at';
  protected defaultSortColumn = 'nom';
  protected allowedSortColumns = ['nom', 'reference', 'categorie', 'prix_vente', 'stock', 'created_at'];

  /**
   * Get paginated products with optional filters
   * Uses stock_par_location for stock calculations
   */
  async getAll(
    search?: string,
    categorie?: string,
    lowStock?: boolean,
    pagination: PaginationParams = { page: 1, limit: 20, sort: 'p.nom', order: 'ASC' },
    locationId?: number
  ): Promise<PaginatedResult<ProduitRecord>> {
    if (locationId !== undefined) {
      const { rows: locationRows } = await pool.query(
        'SELECT id FROM stock_locations WHERE id = $1 AND actif = true LIMIT 1',
        [locationId]
      );

      if (!locationRows[0]) {
        throw new Error('Depot invalide ou inactif');
      }
    }

    const locationFilterJoin = locationId !== undefined
      ? ' AND spl.location_id = $1'
      : '';

    let baseQuery = `
      FROM produits p
      LEFT JOIN stock_par_location spl ON p.id = spl.produit_id${locationFilterJoin}
      LEFT JOIN stock_locations sl ON spl.location_id = sl.id AND sl.actif = true
      WHERE p.deleted_at IS NULL
    `;
    const params: any[] = [];

    if (locationId !== undefined) {
      params.push(locationId);
    }

    if (search) {
      const words = search.trim().split(/\s+/).filter(Boolean);
      for (const word of words) {
        const pattern = `%${word}%`;
        const n = params.length;
        baseQuery += ` AND (p.nom ILIKE $${n + 1} OR p.reference ILIKE $${n + 2} OR COALESCE(p.categorie,'') ILIKE $${n + 3} OR COALESCE(p.description,'') ILIKE $${n + 4})`;
        params.push(pattern, pattern, pattern, pattern);
      }
    }

    if (categorie) {
      baseQuery += ' AND p.categorie = $' + (params.length + 1);
      params.push(categorie);
    }

    const havingClause = lowStock ? ' HAVING COALESCE(SUM(spl.quantite), 0) <= p.stock_min' : '';

    const dataQuery = `
      SELECT p.id, p.reference, p.nom, p.description, p.categorie, 
             p.prix_achat, p.prix_vente, 
             COALESCE(SUM(spl.quantite), 0) as stock,
             p.stock_min, p.created_at, p.updated_at
      ${baseQuery}
      GROUP BY p.id
      ${havingClause}
    `;

    const countQuery = `SELECT COUNT(DISTINCT p.id) as total ${baseQuery}`;

    // Handle sorting — whitelist to prevent SQL injection
    const ALLOWED_SORT = ['nom', 'reference', 'categorie', 'prix_vente', 'stock', 'created_at'];
    const rawSort = (pagination.sort || 'nom').replace(/^p\./, '');
    const safeSortColumn = ALLOWED_SORT.includes(rawSort) ? `p.${rawSort}` : 'p.nom';
    const safeSortOrder = pagination.order === 'DESC' ? 'DESC' : 'ASC';
    const offset = (pagination.page - 1) * pagination.limit;

    const finalDataQuery = `${dataQuery} ORDER BY ${safeSortColumn} ${safeSortOrder} LIMIT ${pagination.limit} OFFSET ${offset}`;

    const [dataResult, countResult] = await Promise.all([
      pool.query(finalDataQuery, params),
      pool.query(countQuery, params)
    ]);

    const total = parseInt(countResult.rows[0].total);

    return {
      data: dataResult.rows,
      pagination: {
        total,
        page: pagination.page,
        limit: pagination.limit,
        totalPages: Math.ceil(total / pagination.limit)
      }
    };
  }

  /**
   * Create a new product
   */
  async create(input: CreateProduitInput): Promise<ProduitRecord> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const requestedInitialStock = input.initial_stock ?? input.stock ?? 0;
      if (requestedInitialStock < 0) {
        throw new Error('Stock initial invalide');
      }

      let effectiveLocationId: number | null = null;

      if (input.location_id !== undefined) {
        const { rows: locationRows } = await client.query(
          'SELECT id FROM stock_locations WHERE id = $1 AND actif = true LIMIT 1',
          [input.location_id]
        );

        if (!locationRows[0]) {
          throw new Error('Depot invalide ou inactif');
        }

        effectiveLocationId = locationRows[0].id;
      } else if (requestedInitialStock > 0) {
        try {
          const { rows: principalRows } = await client.query(
            'SELECT id FROM stock_locations WHERE est_principal = true AND actif = true LIMIT 1'
          );
          if (principalRows[0]) {
            effectiveLocationId = principalRows[0].id;
          }
        } catch (error: any) {
          if (error?.code !== '42P01' && error?.code !== '42703') {
            throw error;
          }
        }
      }

      const initialProductStock = effectiveLocationId ? 0 : requestedInitialStock;

      const { rows: insertRows } = await client.query(
        `INSERT INTO produits (reference, nom, description, categorie, prix_achat, prix_vente, stock, stock_min, cree_par)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          input.reference,
          input.nom,
          input.description || null,
          input.categorie || null,
          input.prix_achat,
          input.prix_vente,
          initialProductStock,
          input.stock_min ?? 5,
          input.cree_par || null,
        ]
      );

      const createdProduct = insertRows[0];

      if (effectiveLocationId && requestedInitialStock > 0) {
        await client.query(
          `INSERT INTO stock_par_location (produit_id, location_id, quantite)
           VALUES ($1, $2, $3)
           ON CONFLICT (produit_id, location_id)
           DO UPDATE SET quantite = stock_par_location.quantite + EXCLUDED.quantite, updated_at = CURRENT_TIMESTAMP`,
          [createdProduct.id, effectiveLocationId, requestedInitialStock]
        );
      }

      const { rows: finalRows } = await client.query('SELECT * FROM produits WHERE id = $1', [createdProduct.id]);

      await client.query('COMMIT');

      return finalRows[0] || createdProduct;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update a product
   */
  async update(id: number, input: UpdateProduitInput): Promise<ProduitRecord | null> {
    const fields: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (input.reference !== undefined) { fields.push(`reference = $${paramIndex++}`); params.push(input.reference); }
    if (input.nom !== undefined) { fields.push(`nom = $${paramIndex++}`); params.push(input.nom); }
    if (input.description !== undefined) { fields.push(`description = $${paramIndex++}`); params.push(input.description || null); }
    if (input.categorie !== undefined) { fields.push(`categorie = $${paramIndex++}`); params.push(input.categorie || null); }
    if (input.prix_achat !== undefined) { fields.push(`prix_achat = $${paramIndex++}`); params.push(input.prix_achat); }
    if (input.prix_vente !== undefined) { fields.push(`prix_vente = $${paramIndex++}`); params.push(input.prix_vente); }
    // stock is intentionally excluded: use adjustStock() or the reception flow
    if (input.stock_min !== undefined) { fields.push(`stock_min = $${paramIndex++}`); params.push(input.stock_min); }
    if (input.modifie_par !== undefined) { fields.push(`modifie_par = $${paramIndex++}`); params.push(input.modifie_par); }

    if (fields.length === 0) throw new Error('Aucun champ à mettre à jour');

    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    const { rows } = await pool.query(
      `UPDATE produits SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      params
    );
    return rows[0] || null;
  }

  /**
   * Adjust stock quantity - Uses stock_par_location
   */
  async adjustStock(id: number, quantite: number, locationId?: number): Promise<{ stock: number } | null> {
    if (locationId) {
      const { rows: locationRows } = await pool.query(
        'SELECT id FROM stock_locations WHERE id = $1 AND actif = true LIMIT 1',
        [locationId]
      );

      if (!locationRows[0]) {
        throw new Error('Depot invalide ou inactif');
      }
    }

    // Get current stock at location (default to MAIN location if not specified)
    const stockQuery = locationId
      ? 'SELECT get_stock_at_location($1, $2) as stock'
      : 'SELECT get_stock_at_location($1) as stock';
    
    const { rows: productRows } = await pool.query(stockQuery, locationId ? [id, locationId] : [id]);
    if (!productRows[0] || productRows[0].stock === null) return null;

    const stockAvant = parseInt(productRows[0].stock);
    const stockApres = stockAvant + quantite;

    // Prevent negative stock
    if (stockApres < 0) {
      throw new Error(`Stock insuffisant. Stock actuel: ${stockAvant}, Ajustement demandé: ${quantite}. Le stock ne peut pas être négatif.`);
    }

    // Use helper function to adjust stock
    const operation = quantite >= 0 ? 'add' : 'remove';
    const absQuantity = Math.abs(quantite);
    
    if (locationId) {
      await pool.query('SELECT adjust_stock_at_location($1, $2, $3, $4)', [id, locationId, absQuantity, operation]);
    } else {
      // Default to MAIN location
      const { rows: locationRows } = await pool.query('SELECT id FROM stock_locations WHERE est_principal = true LIMIT 1');
      if (locationRows[0]) {
        await pool.query('SELECT adjust_stock_at_location($1, $2, $3, $4)', [id, locationRows[0].id, absQuantity, operation]);
      }
    }

    return { stock: stockApres };
  }

  /**
   * Get stock valuation summary - Uses stock_par_location
   */
  async getStockValuation(): Promise<any> {
    const { rows } = await pool.query(
      `SELECT
        COUNT(DISTINCT p.id) as total_produits,
        COALESCE(SUM(spl.quantite), 0) as total_unites,
        COALESCE(SUM(spl.quantite * p.prix_achat), 0) as valeur_achat,
        COALESCE(SUM(spl.quantite * p.prix_vente), 0) as valeur_vente,
        COALESCE(SUM(spl.quantite * (p.prix_vente - p.prix_achat)), 0) as marge_potentielle
       FROM produits p
       LEFT JOIN stock_par_location spl ON p.id = spl.produit_id
       LEFT JOIN stock_locations sl ON spl.location_id = sl.id AND sl.actif = true
       WHERE p.deleted_at IS NULL`
    );
    return rows[0];
  }

  /**
   * Get stock by category - Uses stock_par_location
   */
  async getStockByCategory(): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT
        COALESCE(p.categorie, 'Sans catégorie') as categorie,
        COUNT(DISTINCT p.id) as nombre_produits,
        COALESCE(SUM(spl.quantite), 0) as total_unites,
        COALESCE(SUM(spl.quantite * p.prix_achat), 0) as valeur_achat,
        COALESCE(SUM(spl.quantite * p.prix_vente), 0) as valeur_vente
       FROM produits p
       LEFT JOIN stock_par_location spl ON p.id = spl.produit_id
       LEFT JOIN stock_locations sl ON spl.location_id = sl.id AND sl.actif = true
       WHERE p.deleted_at IS NULL
       GROUP BY p.categorie
       ORDER BY valeur_vente DESC`
    );
    return rows;
  }

  /**
   * Get stock movement history for a product
   */
  async getStockHistory(produitId: number, limit: number = 50): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT * FROM mouvements_stock
       WHERE produit_id = $1
       ORDER BY date_mouvement DESC
       LIMIT $2`,
      [produitId, limit]
    );
    return rows;
  }

  /**
   * Add a stock movement - Uses stock_par_location
   */
  async addStockMovement(
    produitId: number,
    type_mouvement: string,
    quantite: number,
    locationId?: number,
    raison?: string,
    reference_liee?: string
  ): Promise<{ stock: number } | null> {
    // Get current stock at location
    const stockBefore = locationId 
      ? await pool.query('SELECT get_stock_at_location($1, $2) as stock', [produitId, locationId])
      : await pool.query('SELECT get_stock_at_location($1) as stock', [produitId]);
    
    if (!stockBefore.rows[0]) return null;

    const stockAvant = parseInt(stockBefore.rows[0].stock);
    const stockApres = stockAvant + quantite;

    // Insert movement record
    await pool.query(
      `INSERT INTO mouvements_stock
       (produit_id, type_mouvement, quantite, stock_avant, stock_apres, raison, reference_liee, location_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [produitId, type_mouvement, quantite, stockAvant, stockApres, raison || null, reference_liee || null, locationId || null]
    );

    // Update stock at location
    const operation = quantite >= 0 ? 'add' : 'remove';
    const absQuantity = Math.abs(quantite);
    
    if (locationId) {
      await pool.query('SELECT adjust_stock_at_location($1, $2, $3, $4)', [produitId, locationId, absQuantity, operation]);
    } else {
      // Default to MAIN location
      const { rows: locationRows } = await pool.query('SELECT id FROM stock_locations WHERE est_principal = true LIMIT 1');
      if (locationRows[0]) {
        await pool.query('SELECT adjust_stock_at_location($1, $2, $3, $4)', [produitId, locationRows[0].id, absQuantity, operation]);
      }
    }

    return { stock: stockApres };
  }

  /**
   * Fuzzy search with suggestions - Uses pg_trgm for similarity matching
   * Returns products ranked by similarity to the search query
   */
  async searchFuzzy(
    query: string,
    limit: number = 10,
    threshold: number = 0.1
  ): Promise<Array<ProduitRecord & { similarity: number }>> {
    if (!query || query.trim().length < 2) {
      return [];
    }

    const searchTerm = query.trim();

    try {
      const { rows } = await pool.query(
        `SELECT 
          p.id, 
          p.reference, 
          p.nom, 
          p.description, 
          p.categorie, 
          p.prix_achat, 
          p.prix_vente,
          p.stock,
          p.stock_min, 
          p.created_at, 
          p.updated_at,
          GREATEST(
            similarity(p.nom, $1),
            similarity(p.reference, $1) * 0.9,
            similarity(COALESCE(p.description, ''), $1) * 0.7,
            similarity(COALESCE(p.categorie, ''), $1) * 0.5
          ) as similarity
        FROM produits p
        WHERE p.deleted_at IS NULL
          AND (
            p.nom % $1 
            OR p.reference % $1 
            OR COALESCE(p.description, '') % $1
            OR p.nom ILIKE '%' || $1 || '%'
            OR p.reference ILIKE '%' || $1 || '%'
          )
          AND GREATEST(
            similarity(p.nom, $1),
            similarity(p.reference, $1) * 0.9,
            similarity(COALESCE(p.description, ''), $1) * 0.7,
            similarity(COALESCE(p.categorie, ''), $1) * 0.5
          ) > $2
        ORDER BY similarity DESC, p.nom ASC
        LIMIT $3`,
        [searchTerm, threshold, limit]
      );
      return rows;
    } catch (error: any) {
      // Fallback to simple ILIKE search if pg_trgm is not available
      if (error.message?.includes('similarity') || error.message?.includes('operator does not exist')) {
        const { rows } = await pool.query(
          `SELECT 
            p.id, 
            p.reference, 
            p.nom, 
            p.description, 
            p.categorie, 
            p.prix_achat, 
            p.prix_vente,
            p.stock,
            p.stock_min, 
            p.created_at, 
            p.updated_at,
            0.5 as similarity
          FROM produits p
          WHERE p.deleted_at IS NULL
            AND (
              p.nom ILIKE '%' || $1 || '%'
              OR p.reference ILIKE '%' || $1 || '%'
              OR COALESCE(p.description, '') ILIKE '%' || $1 || '%'
            )
          ORDER BY p.nom ASC
          LIMIT $2`,
          [searchTerm, limit]
        );
        return rows;
      }
      throw error;
    }
  }

  /**
   * Get suggestions for autocomplete - fast fuzzy search
   */
  async getSuggestions(
    query: string,
    limit: number = 5
  ): Promise<Array<{ id: number; nom: string; reference: string; categorie: string | null; similarity: number }>> {
    if (!query || query.trim().length < 1) {
      return [];
    }

    const searchTerm = query.trim();

    try {
      const { rows } = await pool.query(
        `SELECT 
          p.id, 
          p.nom, 
          p.reference,
          p.categorie,
          GREATEST(
            similarity(p.nom, $1),
            similarity(p.reference, $1) * 0.9
          ) as similarity
        FROM produits p
        WHERE p.deleted_at IS NULL
          AND (p.nom % $1 OR p.reference % $1 OR p.nom ILIKE '%' || $1 || '%')
        ORDER BY similarity DESC, p.nom ASC
        LIMIT $2`,
        [searchTerm, limit]
      );
      return rows;
    } catch (error: any) {
      // Fallback to simple ILIKE if pg_trgm is not available
      if (error.message?.includes('similarity') || error.message?.includes('operator does not exist')) {
        const { rows } = await pool.query(
          `SELECT 
            p.id, 
            p.nom, 
            p.reference,
            p.categorie,
            0.5 as similarity
          FROM produits p
          WHERE p.deleted_at IS NULL
            AND (p.nom ILIKE '%' || $1 || '%' OR p.reference ILIKE '%' || $1 || '%')
          ORDER BY p.nom ASC
          LIMIT $2`,
          [searchTerm, limit]
        );
        return rows;
      }
      throw error;
    }
  }

  /**
   * Get low stock alert count - Uses stock_par_location
   */
  async getLowStockCount(): Promise<number> {
    const { rows } = await pool.query(
      `SELECT COUNT(*) as count FROM (
        SELECT p.id
        FROM produits p
        LEFT JOIN stock_par_location spl ON p.id = spl.produit_id
        LEFT JOIN stock_locations sl ON spl.location_id = sl.id AND sl.actif = true
        WHERE p.deleted_at IS NULL
        GROUP BY p.id, p.stock_min
        HAVING COALESCE(SUM(spl.quantite), 0) <= p.stock_min
      ) as low_stock_products`
    );
    return parseInt(rows[0].count);
  }
}

export const produitService = new ProduitService();
