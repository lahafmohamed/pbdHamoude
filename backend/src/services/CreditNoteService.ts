import pool from '../db/connection';
import { logAudit } from '../middleware/audit';
import { logger } from '../utils/logger';
import { calculateTotals } from './PricingService';
import { generateDocumentNumber } from './NumberingService';
import { checkPeriodIsOpen } from './PeriodService';

export interface CreditNoteLigneInput {
  produit_id?: number;
  description?: string;
  quantite: number;
  prix_unitaire: number;
}

export interface CreateCreditNoteInput {
  tiers_id: number;
  client_id?: number;
  facture_origine_id?: number;
  retour_id?: number;
  lignes: CreditNoteLigneInput[];
  avoir_type?: 'retour' | 'echange' | 'remise_commerciale' | 'erreur';
  notes?: string;
  location_id?: number;
  cree_par?: number;
  req?: any;
}

export class CreditNoteService {
  /**
   * Get paginated credit notes with optional filters
   */
  async getAll(
    search?: string,
    statut?: string,
    client_id?: number,
    page: number = 1,
    limit: number = 20,
    sort: string = 'date_avoir',
    order: string = 'DESC'
  ): Promise<any> {
    const validSortColumns = ['numero_avoir', 'date_avoir', 'total', 'statut', 'client_nom'];
    const sortColumn = validSortColumns.includes(sort) ? sort : 'date_avoir';
    const sortOrder = order.toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const offset = (page - 1) * limit;

    let query = `
      SELECT fa.*, t.raison_sociale as client_nom, t.prenom as client_prenom,
             sl.nom as location_nom, f.numero_facture as facture_origine_numero,
             r.numero_retour
      FROM factures_avoir fa
      LEFT JOIN tiers t ON fa.tiers_id = t.id
      LEFT JOIN stock_locations sl ON fa.location_id = sl.id
      LEFT JOIN factures f ON fa.facture_origine_id = f.id
      LEFT JOIN retours r ON fa.retour_id = r.id
      WHERE fa.deleted_at IS NULL
    `;
    const params: any[] = [];

    if (search) {
      query += ' AND (fa.numero_avoir ILIKE $' + (params.length + 1) + ' OR t.raison_sociale ILIKE $' + (params.length + 2) + ')';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (statut) {
      query += ' AND fa.statut = $' + (params.length + 1);
      params.push(statut);
    }

    if (client_id) {
      query += ' AND fa.tiers_id = $' + (params.length + 1);
      params.push(client_id);
    }

    query += ` ORDER BY fa.${sortColumn} ${sortOrder} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await pool.query(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) FROM factures_avoir fa WHERE fa.deleted_at IS NULL`;
    const countParams: any[] = [];
    if (search) {
      countQuery += ' AND (fa.numero_avoir ILIKE $' + (countParams.length + 1) + ' OR t.raison_sociale ILIKE $' + (countParams.length + 2) + ')';
      countParams.push(`%${search}%`, `%${search}%`);
    }
    if (statut) {
      countQuery += ' AND fa.statut = $' + (countParams.length + 1);
      countParams.push(statut);
    }
    if (client_id) {
      countQuery += ' AND fa.tiers_id = $' + (countParams.length + 1);
      countParams.push(client_id);
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
   * Get credit note by ID with lines
   */
  async getById(id: number): Promise<any> {
    const { rows: avoirRows } = await pool.query(
      `SELECT fa.*, t.raison_sociale as client_nom, t.prenom as client_prenom, t.email, t.telephone, t.adresse, t.nif,
              sl.nom as location_nom,
              f.numero_facture as facture_origine_numero,
              r.numero_retour
       FROM factures_avoir fa
       LEFT JOIN tiers t ON fa.tiers_id = t.id
       LEFT JOIN stock_locations sl ON fa.location_id = sl.id
       LEFT JOIN factures f ON fa.facture_origine_id = f.id
       LEFT JOIN retours r ON fa.retour_id = r.id
       WHERE fa.id = $1`,
      [id]
    );

    if (avoirRows.length === 0) return null;

    const { rows: lignesRows } = await pool.query(
      `SELECT dl.*, p.nom as produit_nom, p.reference as produit_reference
       FROM document_lignes dl
       LEFT JOIN produits p ON dl.produit_id = p.id
       WHERE dl.document_type = 'avoir' AND dl.document_id = $1
       ORDER BY dl.id`,
      [id]
    );

    return {
      ...avoirRows[0],
      lignes: lignesRows,
    };
  }

  /**
   * Create credit note from return (uses DB function)
   */
  async createFromRetour(retour_id: number, userId: number, req?: any): Promise<{ avoir_id: number; numero_avoir: string }> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Call database function
      const { rows } = await client.query(
        'SELECT create_avoir_from_retour($1, $2) as avoir_id',
        [retour_id, userId]
      );

      const avoirId = rows[0].avoir_id;

      // Get avoir number
      const { rows: avoirRows } = await client.query(
        'SELECT numero_avoir FROM factures_avoir WHERE id = $1',
        [avoirId]
      );

      await client.query('COMMIT');

      // Audit log
      if (userId) {
        await logAudit({
          utilisateur_id: userId,
          action: 'create_from_retour',
          table_name: 'factures_avoir',
          record_id: avoirId,
          req,
          new_values: { retour_id, numero_avoir: avoirRows[0].numero_avoir },
        });
      }

      logger.info({ avoirId, retour_id }, 'Credit note created from return');
      return { avoir_id: avoirId, numero_avoir: avoirRows[0].numero_avoir };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Error creating credit note from return');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Create manual credit note
   */
  async createManual(input: CreateCreditNoteInput): Promise<{ avoir_id: number; numero_avoir: string }> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      await checkPeriodIsOpen(new Date(), client);

      const tiers_id = input.tiers_id ?? input.client_id!;
      const { facture_origine_id, retour_id, lignes, avoir_type, notes, location_id, cree_par, req } = input;

      if (!lignes || lignes.length === 0) {
        throw new Error('Credit note must have at least one line');
      }

      if (!facture_origine_id) {
        throw new Error('Un avoir doit être rattaché à une facture validée');
      }

      const { rows: factureRows } = await client.query(
        `SELECT id, tiers_id, statut
         FROM factures
         WHERE id = $1
           AND deleted_at IS NULL
         FOR UPDATE`,
        [facture_origine_id]
      );

      if (factureRows.length === 0) {
        throw new Error('Facture d\'origine introuvable');
      }

      const facture = factureRows[0];

      if (Number(facture.tiers_id) !== Number(tiers_id)) {
        throw new Error('Le tiers de l\'avoir doit correspondre à la facture d\'origine');
      }

      // An invoice must be validated (not cancelled) to allow credit note creation
      if (facture.statut === 'annulee') {
        throw new Error('On ne peut pas créer un avoir sur une facture annulée');
      }

      // Generate avoir number
      const numeroAvoir = await generateDocumentNumber('avoir', client);

      // Calculate totals
      const { sousTotal, total } = calculateTotals(lignes);

      // Insert credit note
      const { rows: avoirResult } = await client.query(
        'INSERT INTO factures_avoir (numero_avoir, tiers_id, facture_origine_id, retour_id, date_avoir, sous_total, tva, total, total_ht, total_ttc, statut, avoir_type, notes, location_id, cree_par) VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, 0, $6, $6, $6, $7, $8, $9, $10, $11) RETURNING id',
        [numeroAvoir, tiers_id, facture_origine_id || null, retour_id || null, sousTotal, total, 'valide', avoir_type || 'remise_commerciale', notes || null, location_id || null, cree_par || null]
      );

      const avoirId = avoirResult[0].id;

      // Insert lines
      const produitIds: (number | null)[] = [];
      const descriptions: (string | null)[] = [];
      const quantities: number[] = [];
      const prices: number[] = [];
      const totals: number[] = [];

      for (const ligne of lignes) {
        produitIds.push(ligne.produit_id || null);
        descriptions.push(ligne.description || null);
        quantities.push(ligne.quantite);
        prices.push(ligne.prix_unitaire);

        const totalLigne = ligne.quantite * ligne.prix_unitaire;
        totals.push(totalLigne);
      }

      await client.query(
        `INSERT INTO document_lignes (document_type, document_id, produit_id, description, quantite, prix_unitaire, total_ligne)
         SELECT 'avoir', $1, unnest($2::int[]), unnest($3::text[]), unnest($4::int[]), unnest($5::numeric[]), unnest($6::numeric[])`,
        [avoirId, produitIds, descriptions, quantities, prices, totals]
      );

      // Adjust customer account
      await client.query(
        `INSERT INTO compte_client_lignes (tiers_id, type_operation, document_id, document_numero, montant_debit, montant_credit, notes, cree_par)
         VALUES ($1, 'avoir', $2, $3, 0, $4, 'Credit note ' || $5, $6)`,
        [tiers_id, avoirId, numeroAvoir, total, numeroAvoir, cree_par || null]
      );

      await client.query('COMMIT');

      // Audit log
      if (cree_par) {
        await logAudit({
          utilisateur_id: cree_par,
          action: 'create',
          table_name: 'factures_avoir',
          record_id: avoirId,
          req,
          new_values: { numero_avoir: numeroAvoir, tiers_id, total },
        });
      }

      logger.info({ avoirId, numero_avoir: numeroAvoir }, 'Manual credit note created');
      return { avoir_id: avoirId, numero_avoir: numeroAvoir };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Error creating manual credit note');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update credit note status
   */
  async updateStatut(id: number, statut: string, req?: any): Promise<void> {
    const validStatuts = ['brouillon', 'valide', 'annule', 'utilise'];
    if (!validStatuts.includes(statut)) {
      throw new Error('Invalid statut');
    }

    await pool.query(
      'UPDATE factures_avoir SET statut = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [statut, id]
    );

    // Audit log
    if (req?.user?.id) {
      await logAudit({
        utilisateur_id: req.user.id,
        action: 'update_statut',
        table_name: 'factures_avoir',
        record_id: id,
        req,
        new_values: { statut },
      });
    }

    logger.info({ avoirId: id, statut }, 'Credit note statut updated');
  }

  /**
   * Apply credit note to an invoice (marks avoir as 'utilise')
   */
  async applyToFacture(avoirId: number, factureId: number, req?: any): Promise<void> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Lock both records
      const { rows: avoirRows } = await client.query(
        'SELECT id, tiers_id, statut, total FROM factures_avoir WHERE id = $1 FOR UPDATE',
        [avoirId]
      );
      if (avoirRows.length === 0) {
        throw new Error('Avoir non trouvé');
      }
      const avoir = avoirRows[0];
      if (avoir.statut !== 'valide') {
        throw new Error('L\'avoir doit être au statut "valide" pour être appliqué');
      }

      const { rows: factureRows } = await client.query(
        'SELECT id, tiers_id, statut, total FROM factures WHERE id = $1 FOR UPDATE',
        [factureId]
      );
      if (factureRows.length === 0) {
        throw new Error('Facture non trouvée');
      }
      const facture = factureRows[0];
      if (facture.statut === 'annulee') {
        throw new Error('Impossible d\'appliquer un avoir sur une facture annulée');
      }
      if (Number(facture.tiers_id) !== Number(avoir.tiers_id)) {
        throw new Error('L\'avoir et la facture doivent appartenir au même tiers');
      }

      await client.query(
        `UPDATE factures_avoir
         SET statut = 'utilise', facture_appliquee_id = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [factureId, avoirId]
      );

      await client.query('COMMIT');

      if (req?.user?.id) {
        await logAudit({
          utilisateur_id: req.user.id,
          action: 'apply_to_facture',
          table_name: 'factures_avoir',
          record_id: avoirId,
          req,
          new_values: { facture_appliquee_id: factureId, statut: 'utilise' },
        });
      }

      logger.info({ avoirId, factureId }, 'Credit note applied to invoice');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Delete credit note (soft delete)
   */
  async delete(id: number, req?: any): Promise<void> {
    await pool.query(
      'UPDATE factures_avoir SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1',
      [id]
    );

    // Audit log
    if (req?.user?.id) {
      await logAudit({
        utilisateur_id: req.user.id,
        action: 'delete',
        table_name: 'factures_avoir',
        record_id: id,
        req,
      });
    }

    logger.info({ avoirId: id }, 'Credit note deleted');
  }
}

export default new CreditNoteService();
