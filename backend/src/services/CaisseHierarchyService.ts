import pool from '../db/connection';
import { logAudit } from '../middleware/audit';
import { logger } from '../utils/logger';

export interface CreateCaisseInput {
  code: string;
  nom: string;
  type: 'principale' | 'magasin';
  location_id?: number;
  caisse_parent_id?: number;
}

export interface TransfertCaisseInput {
  caisse_source_id: number;
  caisse_dest_id: number;
  montant: number;
  notes?: string;
  cree_par: number;
  req?: any;
}

export class CaisseHierarchyService {
  /**
   * Get all caisses with hierarchy
   */
  async getAll(): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT c.*, sl.nom as location_nom, sl.code as location_code,
              cp.nom as parent_nom, cp.code as parent_code
       FROM caisses c
       LEFT JOIN stock_locations sl ON c.location_id = sl.id
       LEFT JOIN caisses cp ON c.caisse_parent_id = cp.id
       WHERE c.actif = true
       ORDER BY c.type DESC, c.code`
    );
    return rows;
  }

  /**
   * Get caisse by ID
   */
  async getById(id: number): Promise<any> {
    const { rows } = await pool.query(
      `SELECT c.*, sl.nom as location_nom, sl.code as location_code,
              cp.nom as parent_nom, cp.code as parent_code
       FROM caisses c
       LEFT JOIN stock_locations sl ON c.location_id = sl.id
       LEFT JOIN caisses cp ON c.caisse_parent_id = cp.id
       WHERE c.id = $1`,
      [id]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Get caisses by location
   */
  async getByLocation(location_id: number): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT c.*, cp.nom as parent_nom
       FROM caisses c
       LEFT JOIN caisses cp ON c.caisse_parent_id = cp.id
       WHERE c.location_id = $1 AND c.actif = true
       ORDER BY c.type DESC`,
      [location_id]
    );
    return rows;
  }

  /**
   * Get main caisse (caisse principale)
   */
  async getCaissePrincipale(): Promise<any> {
    const { rows } = await pool.query(
      `SELECT c.*, sl.nom as location_nom
       FROM caisses c
       LEFT JOIN stock_locations sl ON c.location_id = sl.id
       WHERE c.type = 'principale' AND c.actif = true
       LIMIT 1`
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Get magasin caisses
   */
  async getMagasinCaisses(): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT c.*, sl.nom as location_nom, cp.nom as parent_nom
       FROM caisses c
       LEFT JOIN stock_locations sl ON c.location_id = sl.id
       LEFT JOIN caisses cp ON c.caisse_parent_id = cp.id
       WHERE c.type = 'magasin' AND c.actif = true
       ORDER BY c.code`
    );
    return rows;
  }

  /**
   * Create a new caisse
   */
  async create(input: CreateCaisseInput, req?: any): Promise<{ id: number }> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { code, nom, type, location_id, caisse_parent_id } = input;

      // Check if code already exists
      const { rows: existingRows } = await client.query(
        'SELECT id FROM caisses WHERE code = $1',
        [code]
      );

      if (existingRows.length > 0) {
        throw new Error('Code de caisse déjà utilisé');
      }

      // Verify parent caisse exists if provided
      if (caisse_parent_id) {
        const { rows: parentRows } = await client.query(
          'SELECT id FROM caisses WHERE id = $1',
          [caisse_parent_id]
        );

        if (parentRows.length === 0) {
          throw new Error('Caisse parent non trouvée');
        }
      }

      // Insert caisse
      const { rows: result } = await client.query(
        'INSERT INTO caisses (code, nom, type, location_id, caisse_parent_id, solde_actuel, actif) VALUES ($1, $2, $3, $4, $5, 0, true) RETURNING id',
        [code, nom, type, location_id || null, caisse_parent_id || null]
      );

      const caisseId = result[0].id;

      await client.query('COMMIT');

      // Audit log
      if (req?.user?.id) {
        await logAudit({
          utilisateur_id: req.user.id,
          action: 'create',
          table_name: 'caisses',
          record_id: caisseId,
          req,
          new_values: { code, nom, type },
        });
      }

      logger.info({ caisseId, code }, 'Caisse created');
      return { id: caisseId };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Error creating caisse');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update caisse
   */
  async update(id: number, input: Partial<CreateCaisseInput>, req?: any): Promise<{ id: number }> {
    const { code, nom, type, location_id, caisse_parent_id } = input;

    const updates: string[] = [];
    const params: any[] = [];

    if (code !== undefined) {
      params.push(code);
      updates.push(`code = $${params.length}`);
    }
    if (nom !== undefined) {
      params.push(nom);
      updates.push(`nom = $${params.length}`);
    }
    if (type !== undefined) {
      params.push(type);
      updates.push(`type = $${params.length}`);
    }
    if (location_id !== undefined) {
      params.push(location_id);
      updates.push(`location_id = $${params.length}`);
    }
    if (caisse_parent_id !== undefined) {
      params.push(caisse_parent_id);
      updates.push(`caisse_parent_id = $${params.length}`);
    }

    if (updates.length > 0) {
      params.push(id);
      await pool.query(
        `UPDATE caisses SET ${updates.join(', ')} WHERE id = $${params.length}`,
        params
      );

      // Audit log
      if (req?.user?.id) {
        await logAudit({
          utilisateur_id: req.user.id,
          action: 'update',
          table_name: 'caisses',
          record_id: id,
          req,
          new_values: input,
        });
      }
    }

    logger.info({ caisseId: id }, 'Caisse updated');
    return { id };
  }

  /**
   * Deactivate caisse
   */
  async deactivate(id: number, req?: any): Promise<void> {
    await pool.query(
      'UPDATE caisses SET actif = false WHERE id = $1',
      [id]
    );

    // Audit log
    if (req?.user?.id) {
      await logAudit({
        utilisateur_id: req.user.id,
        action: 'deactivate',
        table_name: 'caisses',
        record_id: id,
        req,
      });
    }

    logger.info({ caisseId: id }, 'Caisse deactivated');
  }

  /**
   * Transfer funds between caisses
   */
  async transfererFonds(input: TransfertCaisseInput): Promise<{ transfert_id: number; numero_transfert: string }> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { caisse_source_id, caisse_dest_id, montant, notes, cree_par, req } = input;

      // Check source != destination
      if (caisse_source_id === caisse_dest_id) {
        throw new Error('Source and destination caisses must be different');
      }

      // Check source balance
      const { rows: sourceRows } = await client.query(
        'SELECT solde_actuel, code FROM caisses WHERE id = $1',
        [caisse_source_id]
      );

      if (sourceRows.length === 0) {
        throw new Error('Caisse source non trouvée');
      }

      if (sourceRows[0].solde_actuel < montant) {
        throw new Error(`Fonds insuffisants. Disponible: ${sourceRows[0].solde_actuel}, Demandé: ${montant}`);
      }

      // Check destination exists
      const { rows: destRows } = await client.query(
        'SELECT id, code FROM caisses WHERE id = $1',
        [caisse_dest_id]
      );

      if (destRows.length === 0) {
        throw new Error('Caisse destination non trouvée');
      }

      // Call database function
      const { rows: transfertRows } = await client.query(
        'SELECT transferer_fonds_caisse($1, $2, $3, $4, $5) as transfert_id',
        [caisse_source_id, caisse_dest_id, montant, cree_par, notes || null]
      );

      const transfertId = transfertRows[0].transfert_id;

      // Get transfer number
      const { rows: transRows } = await client.query(
        'SELECT numero_transfert FROM transferts_caisse WHERE id = $1',
        [transfertId]
      );

      await client.query('COMMIT');

      // Audit log
      if (cree_par) {
        await logAudit({
          utilisateur_id: cree_par,
          action: 'transfert_caisse',
          table_name: 'transferts_caisse',
          record_id: transfertId,
          req,
          new_values: { caisse_source_id, caisse_dest_id, montant },
        });
      }

      logger.info({ transfertId, montant }, 'Funds transferred between caisses');
      return { transfert_id: transfertId, numero_transfert: transRows[0].numero_transfert };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Error transferring funds');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get transfer history
   */
  async getTransferts(
    caisse_id?: number,
    statut?: string,
    page: number = 1,
    limit: number = 20
  ): Promise<any> {
    const offset = (page - 1) * limit;

    let query = `
      SELECT tc.*, 
             cs.code as source_code, cs.nom as source_nom,
             cd.code as dest_code, cd.nom as dest_nom,
             u.nom as createur_nom
      FROM transferts_caisse tc
      LEFT JOIN caisses cs ON tc.caisse_source_id = cs.id
      LEFT JOIN caisses cd ON tc.caisse_dest_id = cd.id
      LEFT JOIN utilisateurs u ON tc.cree_par = u.id
      WHERE tc.deleted_at IS NULL
    `;
    const params: any[] = [];

    if (caisse_id) {
      query += ' AND (tc.caisse_source_id = $' + (params.length + 1) + ' OR tc.caisse_dest_id = $' + (params.length + 1) + ')';
      params.push(caisse_id);
    }

    if (statut) {
      query += ' AND tc.statut = $' + (params.length + 1);
      params.push(statut);
    }

    query += ` ORDER BY tc.date_transfert DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await pool.query(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) FROM transferts_caisse tc WHERE tc.deleted_at IS NULL`;
    const countParams: any[] = [];
    if (caisse_id) {
      countQuery += ' AND (tc.caisse_source_id = $' + (countParams.length + 1) + ' OR tc.caisse_dest_id = $' + (countParams.length + 1) + ')';
      countParams.push(caisse_id);
    }
    if (statut) {
      countQuery += ' AND tc.statut = $' + (countParams.length + 1);
      countParams.push(statut);
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
   * Get consolidated cash report
   */
  async getConsolidatedReport(): Promise<any> {
    // Get principale caisse
    const principale = await this.getCaissePrincipale();

    // Get all magasin caisses
    const magasinCaisses = await this.getMagasinCaisses();

    // Calculate totals
    const totalPrincipal = principale?.solde_actuel || 0;
    const totalMagasins = magasinCaisses.reduce((sum, c) => sum + parseFloat(c.solde_actuel), 0);
    const totalGeneral = totalPrincipal + totalMagasins;

    return {
      date: new Date().toISOString(),
      caisse_principale: {
        id: principale?.id,
        code: principale?.code,
        nom: principale?.nom,
        solde: totalPrincipal,
        location: principale?.location_nom,
      },
      magasins: magasinCaisses.map((c: any) => ({
        id: c.id,
        code: c.code,
        nom: c.nom,
        solde: parseFloat(c.solde_actuel),
        location: c.location_nom,
      })),
      recapitulatif: {
        total_principal: totalPrincipal,
        total_magasins: totalMagasins,
        total_general: totalGeneral,
      },
    };
  }

  /**
   * Get caisse balance by ID
   */
  async getBalance(id: number): Promise<any> {
    const { rows } = await pool.query(
      `SELECT c.id, c.code, c.nom, c.solde_actuel, c.type,
              sl.nom as location_nom
       FROM caisses c
       LEFT JOIN stock_locations sl ON c.location_id = sl.id
       WHERE c.id = $1`,
      [id]
    );

    if (rows.length === 0) return null;

    // Get recent transfers
    const { rows: transferts } = await pool.query(
      `SELECT tc.*, cs.code as source_code, cd.code as dest_code
       FROM transferts_caisse tc
       LEFT JOIN caisses cs ON tc.caisse_source_id = cs.id
       LEFT JOIN caisses cd ON tc.caisse_dest_id = cd.id
       WHERE (tc.caisse_source_id = $1 OR tc.caisse_dest_id = $1)
         AND tc.statut = 'valide'
       ORDER BY tc.date_transfert DESC
       LIMIT 10`,
      [id]
    );

    return {
      ...rows[0],
      transferts_recents: transferts,
    };
  }
}

export default new CaisseHierarchyService();
