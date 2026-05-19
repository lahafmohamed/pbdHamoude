import pool from '../db/connection';
import { BaseService } from './BaseService';
import { logAudit } from '../middleware/audit';
import { logger } from '../utils/logger';

export interface StockLocationRecord {
  id: number;
  code: string;
  nom: string;
  adresse: string | null;
  responsable_id: number | null;
  actif: boolean;
  est_principal: boolean;
  location_type: 'depot' | 'magasin' | null;
  created_at: string;
}

export interface CreateLocationInput {
  code: string;
  nom: string;
  adresse?: string;
  responsable_id?: number;
  est_principal?: boolean;
  req?: any;
}

export class StockLocationService extends BaseService<StockLocationRecord> {
  protected tableName = 'stock_locations';
  protected selectColumns = 'sl.id, sl.code, sl.nom, sl.adresse, sl.responsable_id, sl.actif, sl.est_principal, sl.location_type, sl.created_at, u.username as responsable_username';
  protected defaultSortColumn = 'created_at';
  protected allowedSortColumns = ['created_at', 'nom', 'code'];

  /**
   * Get all stock locations
   */
  async getAll(options?: { search?: string; actif?: boolean }): Promise<StockLocationRecord[]> {
    let query = `
      SELECT ${this.selectColumns}
      FROM stock_locations sl
      LEFT JOIN utilisateurs u ON sl.responsable_id = u.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (options?.actif !== undefined) {
      query += ` AND sl.actif = $${params.length + 1}`;
      params.push(options.actif);
    }

    if (options?.search) {
      query += ` AND (sl.nom ILIKE $${params.length + 1} OR sl.code ILIKE $${params.length + 2})`;
      params.push(`%${options.search}%`, `%${options.search}%`);
    }

    query += ' ORDER BY sl.est_principal DESC, sl.nom ASC';

    const { rows } = await pool.query(query, params);
    return rows;
  }

  /**
   * Get location by ID
   */
  async getById(id: number): Promise<StockLocationRecord | null> {
    const query = `
      SELECT ${this.selectColumns}
      FROM stock_locations sl
      LEFT JOIN utilisateurs u ON sl.responsable_id = u.id
      WHERE sl.id = $1
    `;
    const { rows } = await pool.query(query, [id]);
    return rows[0] || null;
  }

  /**
   * Create new location
   */
  async create(input: CreateLocationInput): Promise<StockLocationRecord> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { code, nom, adresse, responsable_id, est_principal, req } = input;

      // If this is marked as principal, unset others
      if (est_principal) {
        await client.query('UPDATE stock_locations SET est_principal = false');
      }

      const { rows } = await client.query(
        `INSERT INTO stock_locations (code, nom, adresse, responsable_id, est_principal)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [code, nom, adresse || null, responsable_id || null, est_principal || false]
      );

      await client.query('COMMIT');

      await logAudit({
        utilisateur_id: responsable_id || (req?.user?.id),
        action: 'create',
        table_name: 'stock_locations',
        record_id: rows[0].id,
        req,
        new_values: { code, nom },
      });

      logger.info({ locationId: rows[0].id, code }, 'Stock location created');

      return rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Error creating stock location');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get stock levels for a location
   */
  async getStockLevels(locationId: number): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT spl.id, spl.produit_id, spl.quantite, spl.quantite_reservee,
              p.nom as produit_nom, p.reference, p.prix_vente,
              (spl.quantite - spl.quantite_reservee) as quantite_disponible
       FROM stock_par_location spl
       JOIN produits p ON spl.produit_id = p.id
       WHERE spl.location_id = $1 AND spl.quantite > 0
       ORDER BY p.nom ASC`,
      [locationId]
    );
    return rows;
  }

  /**
   * Get products with stock for a location (optimized for cart selection)
   */
  async getProductsWithStock(locationId: number, search?: string, limit?: number): Promise<any[]> {
    let query = `
      SELECT spl.id, spl.produit_id, spl.quantite, spl.quantite_reservee,
             p.nom as produit_nom, p.reference, p.prix_vente,
             (spl.quantite - spl.quantite_reservee) as quantite_disponible
      FROM stock_par_location spl
      JOIN produits p ON spl.produit_id = p.id
      WHERE spl.location_id = $1 AND spl.quantite > 0
    `;
    const params: any[] = [locationId];

    if (search) {
      query += ` AND (p.nom ILIKE $2 OR p.reference ILIKE $2)`;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY p.nom ASC`;

    if (limit) {
      query += ` LIMIT $${params.length + 1}`;
      params.push(limit);
    }

    const { rows } = await pool.query(query, params);
    return rows;
  }

  /**
   * Update stock for a product at a location
   */
  async updateStock(productId: number, locationId: number, quantity: number): Promise<void> {
    await pool.query(
      `INSERT INTO stock_par_location (produit_id, location_id, quantite)
       VALUES ($1, $2, $3)
       ON CONFLICT (produit_id, location_id)
       DO UPDATE SET quantite = stock_par_location.quantite + $3, updated_at = CURRENT_TIMESTAMP`,
      [productId, locationId, quantity]
    );
  }
}

export const stockLocationService = new StockLocationService();
