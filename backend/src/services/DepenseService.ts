import pool from '../db/connection';
import { logAudit } from '../middleware/audit';
import { logger } from '../utils/logger';
import { checkPeriodIsOpen } from './PeriodService';

export interface CreateDepenseInput {
  location_id?: number;
  session_caisse_id?: number;
  categorie_id: number;
  tiers_id?: number;
  fournisseur_id?: number;
  montant: number;
  methode_paiement: 'espece' | 'carte' | 'cheque' | 'virement';
  date_depense?: string;
  description: string;
  justificatif_url?: string;
  cree_par?: number;
  req?: any;
}

export class DepenseService {
  /**
   * Get paginated expenses with optional filters
   */
  async getAll(
    search?: string,
    location_id?: number,
    categorie_id?: number,
    date_debut?: string,
    date_fin?: string,
    methode_paiement?: string,
    page: number = 1,
    limit: number = 20,
    sort: string = 'date_depense',
    order: string = 'DESC'
  ): Promise<any> {
    const validSortColumns = ['numero_depense', 'date_depense', 'montant', 'categorie_nom', 'location_nom'];
    const sortColumn = validSortColumns.includes(sort) ? sort : 'date_depense';
    const sortOrder = order.toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const offset = (page - 1) * limit;

    let query = `
      SELECT d.*, cd.nom as categorie_nom, cd.code as categorie_code,
             sl.nom as location_nom, sl.code as location_code,
             t.raison_sociale as fournisseur_nom,
             sc.numero_session
      FROM depenses d
      LEFT JOIN categories_depenses cd ON d.categorie_id = cd.id
      LEFT JOIN stock_locations sl ON d.location_id = sl.id
      LEFT JOIN tiers t ON d.tiers_id = t.id
      LEFT JOIN sessions_caisse sc ON d.session_caisse_id = sc.id
      WHERE d.deleted_at IS NULL
    `;
    const params: any[] = [];

    if (search) {
      query += ' AND (d.numero_depense ILIKE $' + (params.length + 1) + ' OR d.description ILIKE $' + (params.length + 2) + ')';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (location_id) {
      query += ' AND d.location_id = $' + (params.length + 1);
      params.push(location_id);
    }

    if (categorie_id) {
      query += ' AND d.categorie_id = $' + (params.length + 1);
      params.push(categorie_id);
    }

    if (date_debut) {
      query += ' AND d.date_depense >= $' + (params.length + 1);
      params.push(date_debut);
    }

    if (date_fin) {
      query += ' AND d.date_depense <= $' + (params.length + 1);
      params.push(date_fin);
    }

    if (methode_paiement) {
      query += ' AND d.methode_paiement = $' + (params.length + 1);
      params.push(methode_paiement);
    }

    query += ` ORDER BY d.${sortColumn} ${sortOrder} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await pool.query(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) FROM depenses d WHERE d.deleted_at IS NULL`;
    const countParams: any[] = [];
    if (search) {
      countQuery += ' AND (d.numero_depense ILIKE $' + (countParams.length + 1) + ' OR d.description ILIKE $' + (countParams.length + 2) + ')';
      countParams.push(`%${search}%`, `%${search}%`);
    }
    if (location_id) {
      countQuery += ' AND d.location_id = $' + (countParams.length + 1);
      countParams.push(location_id);
    }
    if (categorie_id) {
      countQuery += ' AND d.categorie_id = $' + (countParams.length + 1);
      countParams.push(categorie_id);
    }
    if (date_debut) {
      countQuery += ' AND d.date_depense >= $' + (countParams.length + 1);
      countParams.push(date_debut);
    }
    if (date_fin) {
      countQuery += ' AND d.date_depense <= $' + (countParams.length + 1);
      countParams.push(date_fin);
    }
    if (methode_paiement) {
      countQuery += ' AND d.methode_paiement = $' + (countParams.length + 1);
      countParams.push(methode_paiement);
    }
    const { rows: countRows } = await pool.query(countQuery, countParams);
    const total = parseInt(countRows[0].count);

    return {
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get expense by ID
   */
  async getById(id: number): Promise<any> {
    const { rows } = await pool.query(
      `SELECT d.*, cd.nom as categorie_nom, cd.code as categorie_code,
              sl.nom as location_nom, sl.code as location_code,
              t.raison_sociale as fournisseur_nom, t.telephone as fournisseur_telephone,
              sc.numero_session,
              u.nom as createur_nom
       FROM depenses d
       LEFT JOIN categories_depenses cd ON d.categorie_id = cd.id
       LEFT JOIN stock_locations sl ON d.location_id = sl.id
       LEFT JOIN tiers t ON d.tiers_id = t.id
       LEFT JOIN sessions_caisse sc ON d.session_caisse_id = sc.id
       LEFT JOIN utilisateurs u ON d.cree_par = u.id
       WHERE d.id = $1`,
      [id]
    );

    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Create a new expense
   */
  async create(input: CreateDepenseInput): Promise<{ id: number; numero_depense: string }> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      await checkPeriodIsOpen(new Date(), client);

      const { location_id, session_caisse_id, categorie_id, montant, methode_paiement, date_depense, description, justificatif_url, cree_par, req } = input;
      const fournisseur_id = input.tiers_id ?? input.fournisseur_id;

      // Verify category exists
      const { rows: catRows } = await client.query(
        'SELECT id FROM categories_depenses WHERE id = $1 AND actif = true',
        [categorie_id]
      );

      if (catRows.length === 0) {
        throw new Error('Catégorie de dépense invalide');
      }

      // Generate expense number
      const { rows: seqRows } = await client.query("SELECT nextval('depense_seq') as num");
      const numeroDepense = `DEP-${new Date().getFullYear()}-${String(seqRows[0].num).padStart(5, '0')}`;

      // Insert expense
      const { rows: depResult } = await client.query(
        'INSERT INTO depenses (numero_depense, location_id, session_caisse_id, categorie_id, tiers_id, montant, methode_paiement, date_depense, description, justificatif_url, cree_par) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id',
        [numeroDepense, location_id || null, session_caisse_id || null, categorie_id, fournisseur_id || null, montant, methode_paiement, date_depense || new Date().toISOString().split('T')[0], description, justificatif_url || null, cree_par || null]
      );

      const depenseId = depResult[0].id;

      // If linked to caisse session, update session total
      if (session_caisse_id) {
        await client.query(
          'UPDATE sessions_caisse SET total_depenses = COALESCE(total_depenses, 0) + $1 WHERE id = $2',
          [montant, session_caisse_id]
        );
      }

      await client.query('COMMIT');

      // Audit log
      if (cree_par) {
        await logAudit({
          utilisateur_id: cree_par,
          action: 'create',
          table_name: 'depenses',
          record_id: depenseId,
          req,
          new_values: { numero_depense: numeroDepense, montant, categorie_id },
        });
      }

      logger.info({ depenseId, numero_depense: numeroDepense }, 'Expense created');
      return { id: depenseId, numero_depense: numeroDepense };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Error creating expense');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update expense
   */
  async update(id: number, input: Partial<CreateDepenseInput>, req?: any): Promise<{ id: number }> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Check if expense exists
      const { rows: existingRows } = await client.query(
        'SELECT id, session_caisse_id, montant FROM depenses WHERE id = $1',
        [id]
      );

      if (existingRows.length === 0) {
        throw new Error('Dépense non trouvée');
      }

      const { categorie_id, montant, methode_paiement, date_depense, description, justificatif_url, cree_par } = input;
      const tiers_id_update = input.tiers_id ?? input.fournisseur_id;

      // Update expense
      const updates: string[] = [];
      const params: any[] = [];

      if (categorie_id !== undefined) {
        params.push(categorie_id);
        updates.push(`categorie_id = $${params.length}`);
      }
      if (tiers_id_update !== undefined) {
        params.push(tiers_id_update);
        updates.push(`tiers_id = $${params.length}`);
      }
      if (montant !== undefined) {
        params.push(montant);
        updates.push(`montant = $${params.length}`);
      }
      if (methode_paiement !== undefined) {
        params.push(methode_paiement);
        updates.push(`methode_paiement = $${params.length}`);
      }
      if (date_depense !== undefined) {
        params.push(date_depense);
        updates.push(`date_depense = $${params.length}`);
      }
      if (description !== undefined) {
        params.push(description);
        updates.push(`description = $${params.length}`);
      }
      if (justificatif_url !== undefined) {
        params.push(justificatif_url);
        updates.push(`justificatif_url = $${params.length}`);
      }

      if (updates.length > 0) {
        // If amount changed and linked to caisse, update session
        if (montant !== undefined && existingRows[0].session_caisse_id) {
          const oldMontant = existingRows[0].montant;
          const diff = montant - oldMontant;
          await client.query(
            'UPDATE sessions_caisse SET total_depenses = COALESCE(total_depenses, 0) + $1 WHERE id = $2',
            [diff, existingRows[0].session_caisse_id]
          );
        }

        params.push(id);
        await client.query(
          `UPDATE depenses SET ${updates.join(', ')} WHERE id = $${params.length}`,
          params
        );
      }

      await client.query('COMMIT');

      // Audit log
      if (cree_par) {
        await logAudit({
          utilisateur_id: cree_par,
          action: 'update',
          table_name: 'depenses',
          record_id: id,
          req,
          new_values: input,
        });
      }

      logger.info({ depenseId: id }, 'Expense updated');
      return { id };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Error updating expense');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Delete expense (soft delete)
   */
  async delete(id: number, req?: any): Promise<void> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get expense to check caisse linkage
      const { rows } = await client.query(
        'SELECT montant, session_caisse_id FROM depenses WHERE id = $1',
        [id]
      );

      if (rows.length === 0) {
        throw new Error('Dépense non trouvée');
      }

      // If linked to caisse, update session
      if (rows[0].session_caisse_id) {
        await client.query(
          'UPDATE sessions_caisse SET total_depenses = COALESCE(total_depenses, 0) - $1 WHERE id = $2',
          [rows[0].montant, rows[0].session_caisse_id]
        );
      }

      // Soft delete
      await client.query(
        'UPDATE depenses SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1',
        [id]
      );

      await client.query('COMMIT');

      // Audit log
      if (req?.user?.id) {
        await logAudit({
          utilisateur_id: req.user.id,
          action: 'delete',
          table_name: 'depenses',
          record_id: id,
          req,
        });
      }

      logger.info({ depenseId: id }, 'Expense deleted');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Error deleting expense');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get expense categories
   */
  async getCategories(): Promise<any[]> {
    const { rows } = await pool.query(
      'SELECT * FROM categories_depenses WHERE actif = true ORDER BY nom',
    );
    return rows;
  }

  /**
   * Get expense reports by location
   */
  async getReportByLocation(date_debut?: string, date_fin?: string): Promise<any[]> {
    let query = `
      SELECT 
        sl.code as location_code,
        sl.nom as location_nom,
        COUNT(d.id) as nombre_depenses,
        COALESCE(SUM(d.montant), 0) as total_depenses,
        cd.nom as categorie_nom,
        cd.code as categorie_code
      FROM depenses d
      LEFT JOIN stock_locations sl ON d.location_id = sl.id
      LEFT JOIN categories_depenses cd ON d.categorie_id = cd.id
      WHERE d.deleted_at IS NULL
    `;
    const params: any[] = [];

    if (date_debut) {
      query += ' AND d.date_depense >= $' + (params.length + 1);
      params.push(date_debut);
    }

    if (date_fin) {
      query += ' AND d.date_depense <= $' + (params.length + 1);
      params.push(date_fin);
    }

    query += ` GROUP BY sl.code, sl.nom, cd.nom, cd.code ORDER BY total_depenses DESC`;

    const { rows } = await pool.query(query, params);
    return rows;
  }

  /**
   * Get expense reports by category
   */
  async getReportByCategorie(date_debut?: string, date_fin?: string): Promise<any[]> {
    let query = `
      SELECT 
        cd.code as categorie_code,
        cd.nom as categorie_nom,
        COUNT(d.id) as nombre_depenses,
        COALESCE(SUM(d.montant), 0) as total_depenses,
        AVG(d.montant) as moyenne_depense
      FROM depenses d
      LEFT JOIN categories_depenses cd ON d.categorie_id = cd.id
      WHERE d.deleted_at IS NULL
    `;
    const params: any[] = [];

    if (date_debut) {
      query += ' AND d.date_depense >= $' + (params.length + 1);
      params.push(date_debut);
    }

    if (date_fin) {
      query += ' AND d.date_depense <= $' + (params.length + 1);
      params.push(date_fin);
    }

    query += ` GROUP BY cd.code, cd.nom ORDER BY total_depenses DESC`;

    const { rows } = await pool.query(query, params);
    return rows;
  }
}

export const depenseService = new DepenseService();
export default depenseService;
