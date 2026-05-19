import pool from '../db/connection';
import { logAudit } from '../middleware/audit';
import { logger } from '../utils/logger';
import { calculateTotals } from './PricingService';
import { generateDocumentNumber } from './NumberingService';

export interface BonLivraisonLigneInput {
  produit_id?: number;
  description?: string;
  quantite_commandee: number;
  quantite_livree?: number;
  prix_unitaire: number;
}

export interface CreateBonLivraisonInput {
  tiers_id: number;
  client_id?: number;
  devis_id?: number;
  lignes: BonLivraisonLigneInput[];
  notes?: string;
  adresse_livraison?: string;
  date_livraison_prevue?: string;
  location_id?: number;
  cree_par?: number;
  req?: any;
}

export class BonLivraisonService {
  private normalizeStatutInput(statut: string): string {
    if (statut === 'en_attente') return 'valide';
    if (statut === 'livre') return 'livre';
    return statut;
  }

  private async convertToFactureFallback(
    client: any,
    blId: number
  ): Promise<{ facture_id: number; numero_facture: string }> {
    const { rows: blRows } = await client.query(
      `SELECT id, tiers_id, sous_total, tva, total, notes, location_id, facture_id
       FROM bons_livraison
       WHERE id = $1
       FOR UPDATE`,
      [blId]
    );

    if (blRows.length === 0) {
      throw new Error('Bon de livraison non trouvé');
    }

    const bl = blRows[0];

    if (bl.facture_id) {
      const { rows: existingRows } = await client.query(
        'SELECT numero_facture FROM factures WHERE id = $1',
        [bl.facture_id]
      );
      return {
        facture_id: bl.facture_id,
        numero_facture: existingRows[0]?.numero_facture || '',
      };
    }

    const numeroFacture = await generateDocumentNumber('facture', client);

    const { rows: factureRows } = await client.query(
      `INSERT INTO factures (
        numero_facture,
        tiers_id,
        bl_id,
        devis_id,
        date_facture,
        sous_total,
        tva,
        total,
        montant_paye,
        remaining_due,
        statut,
        notes,
        location_id
      ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id`,
      [
        numeroFacture,
        bl.tiers_id,
        blId,
        bl.devis_id || null,
        bl.sous_total,
        bl.tva,
        bl.total,
        0,
        bl.total,
        'en_attente',
        bl.notes || null,
        bl.location_id || null,
      ]
    );

    const factureId = factureRows[0].id;

    const { rows: lignesRows } = await client.query(
      `SELECT produit_id, quantite_livree, prix_unitaire, total_ligne
       FROM document_lignes
       WHERE document_type = 'bl' AND document_id = $1
       ORDER BY id`,
      [blId]
    );

    for (const ligne of lignesRows) {
      await client.query(
        `INSERT INTO document_lignes (
          document_type,
          document_id,
          produit_id,
          quantite,
          prix_unitaire,
          total_ligne
        ) VALUES ('facture', $1, $2, $3, $4, $5)`,
        [
          factureId,
          ligne.produit_id,
          ligne.quantite_livree,
          ligne.prix_unitaire,
          ligne.total_ligne,
        ]
      );
    }

    await client.query(
      "UPDATE bons_livraison SET statut = 'facture', facture_id = $1 WHERE id = $2",
      [factureId, blId]
    );

    return { facture_id: factureId, numero_facture: numeroFacture };
  }

  /**
   * Get paginated delivery notes with optional filters
   */
  async getAll(
    search?: string,
    statut?: string,
    client_id?: number,
    page: number = 1,
    limit: number = 20,
    sort: string = 'date_bl',
    order: string = 'DESC'
  ): Promise<any> {
    const validSortColumns = ['numero_bl', 'date_bl', 'total', 'statut', 'client_nom'];
    const sortColumn = validSortColumns.includes(sort) ? sort : 'date_bl';
    const sortOrder = order.toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const offset = (page - 1) * limit;

    let query = `
      SELECT bl.*, t.raison_sociale as client_nom, t.prenom as client_prenom,
             sl.nom as location_nom, d.numero_devis
      FROM bons_livraison bl
      LEFT JOIN tiers t ON bl.tiers_id = t.id
      LEFT JOIN stock_locations sl ON bl.location_id = sl.id
      LEFT JOIN devis d ON bl.devis_id = d.id
      WHERE bl.deleted_at IS NULL
    `;
    const params: any[] = [];

    if (search) {
      query += ' AND (bl.numero_bl ILIKE $' + (params.length + 1) + ' OR t.raison_sociale ILIKE $' + (params.length + 2) + ')';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (statut) {
      query += ' AND bl.statut = $' + (params.length + 1);
      params.push(statut);
    }

    if (client_id) {
      query += ' AND bl.tiers_id = $' + (params.length + 1);
      params.push(client_id);
    }

    query += ` ORDER BY bl.${sortColumn} ${sortOrder} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await pool.query(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) FROM bons_livraison bl LEFT JOIN tiers t ON bl.tiers_id = t.id WHERE bl.deleted_at IS NULL`;
    const countParams: any[] = [];
    if (search) {
      countQuery += ' AND (bl.numero_bl ILIKE $' + (countParams.length + 1) + ' OR t.raison_sociale ILIKE $' + (countParams.length + 2) + ')';
      countParams.push(`%${search}%`, `%${search}%`);
    }
    if (statut) {
      countQuery += ' AND bl.statut = $' + (countParams.length + 1);
      countParams.push(statut);
    }
    if (client_id) {
      countQuery += ' AND bl.tiers_id = $' + (countParams.length + 1);
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
   * Get delivery note by ID with lines
   */
  async getById(id: number): Promise<any> {
    const { rows: blRows } = await pool.query(
      `SELECT bl.*, t.raison_sociale as client_nom, t.prenom as client_prenom, t.email, t.telephone, t.adresse, t.nif,
              sl.nom as location_nom, sl.code as location_code,
              d.numero_devis as devis_numero,
              f.numero_facture as facture_numero
       FROM bons_livraison bl
       LEFT JOIN tiers t ON bl.tiers_id = t.id
       LEFT JOIN stock_locations sl ON bl.location_id = sl.id
       LEFT JOIN devis d ON bl.devis_id = d.id
       LEFT JOIN factures f ON bl.facture_id = f.id
       WHERE bl.id = $1 AND bl.deleted_at IS NULL`,
      [id]
    );

    if (blRows.length === 0) return null;

    const { rows: lignesRows } = await pool.query(
      `SELECT dl.*, p.nom as produit_nom, p.reference as produit_reference
       FROM document_lignes dl
       LEFT JOIN produits p ON dl.produit_id = p.id
       WHERE dl.document_type = 'bl' AND dl.document_id = $1
       ORDER BY dl.id`,
      [id]
    );

    return {
      ...blRows[0],
      lignes: lignesRows,
    };
  }

  /**
   * Create a new delivery note
   */
  async create(input: CreateBonLivraisonInput): Promise<{ id: number; numero_bl: string; total: number }> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const tiers_id = input.tiers_id ?? input.client_id!;
      const { lignes, devis_id, notes, adresse_livraison, date_livraison_prevue, location_id, cree_par, req } = input;

      if (!lignes || lignes.length === 0) {
        throw new Error('Le bon de livraison doit contenir au moins un produit');
      }

      if (!devis_id) {
        throw new Error('Un bon de livraison doit toujours être lié à un devis confirmé');
      }

      const { rows: devisRows } = await client.query(
        `SELECT id, tiers_id, statut
         FROM devis
         WHERE id = $1
         FOR UPDATE`,
        [devis_id]
      );

      if (devisRows.length === 0) {
        throw new Error('Devis non trouvé');
      }

      if (devisRows[0].statut !== 'accepte') {
        throw new Error('Le devis doit être confirmé avant de créer un bon de livraison');
      }

      if (Number(devisRows[0].tiers_id) !== Number(tiers_id)) {
        throw new Error('Le tiers du bon de livraison doit correspondre au tiers du devis');
      }

      // Generate BL number
      const numeroBL = await generateDocumentNumber('bl', client);

      // Calculate totals
      const pricingLignes = lignes.map(l => ({
        quantite: l.quantite_livree ?? l.quantite_commandee,
        prix_unitaire: l.prix_unitaire,
      }));
      const { sousTotal, total } = calculateTotals(pricingLignes);

      // Insert delivery note
      const { rows: blResult } = await client.query(
        'INSERT INTO bons_livraison (numero_bl, tiers_id, devis_id, date_bl, sous_total, tva, total, notes, adresse_livraison, date_livraison_prevue, location_id, statut, cree_par) VALUES ($1, $2, $3, CURRENT_DATE, $4, 0, $5, $6, $7, $8, $9, $10, $11) RETURNING id',
        [numeroBL, tiers_id, devis_id, sousTotal, total, notes || null, adresse_livraison || null, date_livraison_prevue || null, location_id || null, 'valide', cree_par || null]
      );

      const blId = blResult[0].id;

      // Batch insert lines
      const produitIds: (number | null)[] = [];
      const descriptions: (string | null)[] = [];
      const quantitesCommandees: number[] = [];
      const quantitesLivrees: number[] = [];
      const prices: number[] = [];
      const totals: number[] = [];

      for (const ligne of lignes) {
        produitIds.push(ligne.produit_id || null);
        descriptions.push(ligne.description || null);
        quantitesCommandees.push(ligne.quantite_commandee);
        quantitesLivrees.push(ligne.quantite_livree || ligne.quantite_commandee);
        prices.push(ligne.prix_unitaire);

        const totalLigne = (ligne.quantite_livree || ligne.quantite_commandee) * ligne.prix_unitaire;
        totals.push(totalLigne);
      }

      await client.query(
        `INSERT INTO document_lignes (document_type, document_id, produit_id, description, quantite, quantite_livree, prix_unitaire, total_ligne)
         SELECT 'bl', $1, unnest($2::int[]), unnest($3::text[]), unnest($4::int[]), unnest($5::int[]), unnest($6::numeric[]), unnest($7::numeric[])`,
        [blId, produitIds, descriptions, quantitesCommandees, quantitesLivrees, prices, totals]
      );

      await client.query('COMMIT');

      // Audit log
      if (cree_par) {
        await logAudit({
          utilisateur_id: cree_par,
          action: 'create',
          table_name: 'bons_livraison',
          record_id: blId,
          req,
          new_values: { numero_bl: numeroBL, tiers_id, total },
        });
      }

      logger.info({ blId, numero_bl: numeroBL }, 'Delivery note created successfully');
      return { id: blId, numero_bl: numeroBL, total };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Error creating delivery note');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update delivery note
   */
  async update(
    id: number,
    input: Partial<CreateBonLivraisonInput>,
    req?: any
  ): Promise<{ id: number }> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Check if BL exists and is editable
      const { rows: existingRows } = await client.query(
        'SELECT id, statut FROM bons_livraison WHERE id = $1',
        [id]
      );

      if (existingRows.length === 0) {
        throw new Error('Bon de livraison non trouvé');
      }

      if (['facture', 'annule'].includes(existingRows[0].statut)) {
        throw new Error('Cannot modify a delivery note that has been invoiced or cancelled');
      }

      const upd_tiers_id = input.tiers_id ?? input.client_id;
      const { lignes, notes, adresse_livraison, date_livraison_prevue, location_id, cree_par } = input;

      const updates: string[] = [];
      const params: any[] = [];

      if (upd_tiers_id !== undefined) {
        params.push(upd_tiers_id);
        updates.push(`tiers_id = $${params.length}`);
      }
      if (notes !== undefined) {
        params.push(notes);
        updates.push(`notes = $${params.length}`);
      }
      if (adresse_livraison !== undefined) {
        params.push(adresse_livraison);
        updates.push(`adresse_livraison = $${params.length}`);
      }
      if (date_livraison_prevue !== undefined) {
        params.push(date_livraison_prevue);
        updates.push(`date_livraison_prevue = $${params.length}`);
      }
      if (location_id !== undefined) {
        params.push(location_id);
        updates.push(`location_id = $${params.length}`);
      }

      if (updates.length > 0) {
        params.push(id);
        await client.query(
          `UPDATE bons_livraison SET ${updates.join(', ')} WHERE id = $${params.length}`,
          params
        );
      }

      // Recalculate totals if lines provided
      if (lignes && lignes.length > 0) {
        // Delete old lines
        await client.query("DELETE FROM document_lignes WHERE document_type = 'bl' AND document_id = $1", [id]);

        // Recalculate
        const produitIds: (number | null)[] = [];
        const descriptions: (string | null)[] = [];
        const quantitesCommandees: number[] = [];
        const quantitesLivrees: number[] = [];
        const prices: number[] = [];

        for (const ligne of lignes) {
          produitIds.push(ligne.produit_id || null);
          descriptions.push(ligne.description || null);
          quantitesCommandees.push(ligne.quantite_commandee);
          quantitesLivrees.push(ligne.quantite_livree || ligne.quantite_commandee);
          prices.push(ligne.prix_unitaire);
        }

        const pricingLignes = lignes.map(l => ({
          quantite: l.quantite_livree ?? l.quantite_commandee,
          prix_unitaire: l.prix_unitaire,
        }));
        const { sousTotal, total, totalLignes: totals } = calculateTotals(pricingLignes);

        // Update BL totals
        await client.query(
          'UPDATE bons_livraison SET sous_total = $1, tva = 0, total = $2 WHERE id = $3',
          [sousTotal, total, id]
        );

        // Insert new lines
        await client.query(
          `INSERT INTO document_lignes (document_type, document_id, produit_id, description, quantite, quantite_livree, prix_unitaire, total_ligne)
           SELECT 'bl', $1, unnest($2::int[]), unnest($3::text[]), unnest($4::int[]), unnest($5::int[]), unnest($6::numeric[]), unnest($7::numeric[])`,
          [id, produitIds, descriptions, quantitesCommandees, quantitesLivrees, prices, totals]
        );
      }

      await client.query('COMMIT');

      // Audit log
      if (cree_par) {
        await logAudit({
          utilisateur_id: cree_par,
          action: 'update',
          table_name: 'bons_livraison',
          record_id: id,
          req,
          new_values: input,
        });
      }

      logger.info({ blId: id }, 'Delivery note updated');
      return { id };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Error updating delivery note');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update delivery note status
   */
  async updateStatut(id: number, statut: string, req?: any): Promise<void> {
    const normalizedStatut = this.normalizeStatutInput(statut);
    const validStatuts = ['valide', 'livre', 'facture', 'annule'];
    if (!validStatuts.includes(normalizedStatut)) {
      throw new Error('Invalid statut');
    }

    if (normalizedStatut === 'facture') {
      throw new Error('Le statut facture est mis à jour automatiquement après conversion en facture');
    }

    const { rows: blRows } = await pool.query(
      'SELECT id, devis_id, statut FROM bons_livraison WHERE id = $1',
      [id]
    );

    if (blRows.length === 0) {
      throw new Error('Bon de livraison non trouvé');
    }

    if (blRows[0].statut === 'facture' || blRows[0].statut === 'annule') {
      throw new Error('Impossible de modifier le statut d\'un bon de livraison facturé ou annulé');
    }

    if (blRows[0].devis_id) {
      const { rows: devisRows } = await pool.query(
        'SELECT statut FROM devis WHERE id = $1',
        [blRows[0].devis_id]
      );

      if (devisRows.length === 0) {
        throw new Error('Devis parent introuvable');
      }

      if (devisRows[0].statut === 'annule') {
        throw new Error('Impossible de modifier ce bon de livraison: le devis parent est annulé');
      }
    }

    await pool.query(
      'UPDATE bons_livraison SET statut = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [normalizedStatut, id]
    );

    // Audit log
    if (req?.user?.id) {
      await logAudit({
        utilisateur_id: req.user.id,
        action: 'update_statut',
        table_name: 'bons_livraison',
        record_id: id,
        req,
        new_values: { statut: normalizedStatut },
      });
    }

    logger.info({ blId: id, statut: normalizedStatut }, 'Delivery note statut updated');
  }

  /**
   * Convert delivery note to invoice
   */
  async convertToFacture(id: number, userId: number, req?: any): Promise<{ facture_id: number; numero_facture: string }> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { rows: blRows } = await client.query(
        `SELECT id, statut, devis_id, facture_id
         FROM bons_livraison
         WHERE id = $1
         FOR UPDATE`,
        [id]
      );

      if (blRows.length === 0) {
        throw new Error('Bon de livraison non trouvé');
      }

      const bl = blRows[0];

      if (bl.facture_id) {
        const { rows: existingFactureRows } = await client.query(
          'SELECT numero_facture FROM factures WHERE id = $1',
          [bl.facture_id]
        );

        await client.query('COMMIT');
        return {
          facture_id: bl.facture_id,
          numero_facture: existingFactureRows[0]?.numero_facture || '',
        };
      }

      if (bl.statut !== 'livre') {
        throw new Error('La facture ne peut être créée que pour un bon de livraison marqué comme livré');
      }

      if (!bl.devis_id) {
        throw new Error('Un bon de livraison doit être lié à un devis pour être facturé');
      }

      const { rows: devisRows } = await client.query(
        'SELECT id, statut FROM devis WHERE id = $1 FOR UPDATE',
        [bl.devis_id]
      );

      if (devisRows.length === 0) {
        throw new Error('Devis parent introuvable');
      }

      if (devisRows[0].statut !== 'accepte') {
        throw new Error('On ne peut pas facturer sans devis confirmé');
      }

      let factureId: number;
      let numeroFacture: string;

      await client.query('SAVEPOINT bl_convert_sp');
      try {
        // Preferred path: DB-native conversion.
        const { rows } = await client.query(
          'SELECT convert_bl_to_facture($1, $2) as facture_id',
          [id, userId]
        );

        factureId = rows[0].facture_id;

        const { rows: factureRows } = await client.query(
          'SELECT numero_facture FROM factures WHERE id = $1',
          [factureId]
        );
        numeroFacture = factureRows[0].numero_facture;
      } catch (error: any) {
        const isLegacyNumeroParseError =
          error?.code === '22P02' &&
          String(error?.message || '').includes('invalid input syntax for type integer');

        if (!isLegacyNumeroParseError) {
          throw error;
        }

        // Legacy SQL function fails on FAC-YYYY-##### formats.
        await client.query('ROLLBACK TO SAVEPOINT bl_convert_sp');
        const fallbackResult = await this.convertToFactureFallback(client, id);
        factureId = fallbackResult.facture_id;
        numeroFacture = fallbackResult.numero_facture;
      }

      await client.query('COMMIT');

      // Audit log
      if (userId) {
        await logAudit({
          utilisateur_id: userId,
          action: 'convert_to_facture',
          table_name: 'bons_livraison',
          record_id: id,
          req,
          new_values: { facture_id: factureId },
        });
      }

      logger.info({ blId: id, factureId }, 'Delivery note converted to invoice');
      return { facture_id: factureId, numero_facture: numeroFacture };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Error converting delivery note to invoice');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Delete delivery note (soft delete)
   */
  async delete(id: number, req?: any): Promise<void> {
    await pool.query(
      'UPDATE bons_livraison SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );

    // Audit log
    if (req?.user?.id) {
      await logAudit({
        utilisateur_id: req.user.id,
        action: 'delete',
        table_name: 'bons_livraison',
        record_id: id,
        req,
      });
    }

    logger.info({ blId: id }, 'Delivery note soft-deleted');
  }
}

export default new BonLivraisonService();
