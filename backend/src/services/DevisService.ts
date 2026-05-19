import pool from '../db/connection';
import { logAudit } from '../middleware/audit';
import { logger } from '../utils/logger';
import { calculateTotals } from './PricingService';
import { generateDocumentNumber } from './NumberingService';
import { resolveSalesLocationId } from './StockMagasinService';

export interface DevisLigneInput {
  produit_id?: number;
  description?: string;
  quantite: number;
  prix_unitaire: number;
  remise_pct?: number;
  remise_montant?: number;
}

export interface CreateDevisInput {
  tiers_id: number;
  client_id?: number;
  lignes: DevisLigneInput[];
  date_validite?: string;
  notes?: string;
  conditions?: string;
  location_id?: number;
  remise_globale?: number;
  remise_globale_pct?: number;
  cree_par?: number;
  req?: any;
}

export class DevisService {
  private normalizeStatutInput(statut: string): string {
    if (statut === 'confirme') return 'accepte';
    if (statut === 'confirmee') return 'accepte';
    return statut;
  }

  private isMagasinLocation(location: { code?: string | null; nom?: string | null }): boolean {
    const code = String(location.code || '').toUpperCase();
    const nom = String(location.nom || '').toUpperCase();

    if (code.startsWith('MAG') || nom.includes('MAGASIN')) return true;
    if (code.startsWith('DEPOT') || nom.includes('DEPOT') || nom.includes('DÉPÔT')) return false;

    return true;
  }

  private async resolveMagasinLocationId(client: any, requestedLocationId?: number | null): Promise<number> {
    return resolveSalesLocationId(requestedLocationId ?? null, client);
  }

  private async createBonLivraisonFromDevis(
    client: any,
    devisId: number,
    userId?: number
  ): Promise<{ bl_id: number; numero_bl: string } | null> {
    const { rows: existingBLRows } = await client.query(
      `SELECT id, numero_bl
       FROM bons_livraison
       WHERE devis_id = $1
         AND statut <> 'annule'
       ORDER BY id DESC
       LIMIT 1`,
      [devisId]
    );

    if (existingBLRows.length > 0) {
      return { bl_id: existingBLRows[0].id, numero_bl: existingBLRows[0].numero_bl };
    }

    const { rows: devisRows } = await client.query(
      `SELECT id, tiers_id, sous_total, tva, total, notes, location_id
       FROM devis
       WHERE id = $1
       FOR UPDATE`,
      [devisId]
    );

    if (devisRows.length === 0) {
      throw new Error('Devis non trouvé');
    }

    const devis = devisRows[0];

    const { rows: lignesRows } = await client.query(
      `SELECT produit_id, description, quantite, prix_unitaire, total_ligne
       FROM document_lignes
       WHERE document_type = 'devis' AND document_id = $1
       ORDER BY id`,
      [devisId]
    );

    if (lignesRows.length === 0) {
      throw new Error('Le devis ne contient aucune ligne à livrer');
    }

    const { rows: seqRows } = await client.query("SELECT nextval('bl_seq') as num");
    const numeroBL = `BL-${new Date().getFullYear()}-${String(seqRows[0].num).padStart(5, '0')}`;

    const { rows: blResult } = await client.query(
      `INSERT INTO bons_livraison (
        numero_bl,
        tiers_id,
        devis_id,
        date_bl,
        sous_total,
        tva,
        total,
        notes,
        location_id,
        statut,
        cree_par
      ) VALUES (
        $1, $2, $3, CURRENT_DATE, $4, $5, $6, $7, $8, $9, $10
      )
      RETURNING id`,
      [
        numeroBL,
        devis.tiers_id,
        devisId,
        devis.sous_total,
        devis.tva,
        devis.total,
        devis.notes || null,
        devis.location_id || null,
        'valide',
        userId || null,
      ]
    );

    const blId = blResult[0].id;

    for (const ligne of lignesRows) {
      await client.query(
        `INSERT INTO document_lignes (
          document_type,
          document_id,
          produit_id,
          description,
          quantite,
          quantite_livree,
          prix_unitaire,
          total_ligne,
          parent_ligne_id
        ) VALUES ('bl', $1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          blId,
          ligne.produit_id || null,
          ligne.description || null,
          ligne.quantite,
          ligne.quantite,
          ligne.prix_unitaire,
          ligne.total_ligne,
          ligne.id,
        ]
      );
    }

    return { bl_id: blId, numero_bl: numeroBL };
  }

  private async convertToFactureFallback(
    client: any,
    id: number,
    userId: number
  ): Promise<{ facture_id: number; numero_facture: string }> {
    const { rows: devisRows } = await client.query(
      `SELECT id, tiers_id, sous_total, tva, total, notes, remise_globale, remise_globale_pct, facture_id
       FROM devis
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    if (devisRows.length === 0) {
      throw new Error('Devis non trouvé');
    }

    const devis = devisRows[0];
    if (devis.facture_id) {
      const { rows: existingFacture } = await client.query(
        'SELECT numero_facture FROM factures WHERE id = $1',
        [devis.facture_id]
      );
      return {
        facture_id: devis.facture_id,
        numero_facture: existingFacture[0]?.numero_facture || '',
      };
    }

    const { rows: lignes } = await client.query(
      `SELECT dl.produit_id, dl.quantite, dl.prix_unitaire, dl.total_ligne
       FROM document_lignes dl
       WHERE dl.document_type = 'devis' AND dl.document_id = $1
       ORDER BY dl.id`,
      [id]
    );

    if (lignes.length === 0) {
      throw new Error('Le devis ne contient aucune ligne à convertir');
    }

    const numeroFacture = await generateDocumentNumber('facture', client);

    const { rows: factureRows } = await client.query(
      `INSERT INTO factures (
        numero_facture,
        tiers_id,
        devis_id,
        sous_total,
        tva,
        total,
        montant_paye,
        remaining_due,
        statut,
        notes,
        cree_par,
        remise_globale,
        remise_globale_pct
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
      )
      RETURNING id`,
      [
        numeroFacture,
        devis.tiers_id,
        id,
        devis.sous_total,
        devis.tva,
        devis.total,
        0,
        devis.total,
        'en_attente',
        devis.notes || null,
        userId || null,
        devis.remise_globale || 0,
        devis.remise_globale_pct || 0,
      ]
    );

    const factureId = factureRows[0].id;

    for (const ligne of lignes) {
      const totalLigne = Number(ligne.total_ligne || Number(ligne.quantite) * Number(ligne.prix_unitaire));

      await client.query(
        `INSERT INTO document_lignes (
          document_type,
          document_id,
          produit_id,
          quantite,
          prix_unitaire,
          total_ligne,
          parent_ligne_id
        ) VALUES ('facture', $1, $2, $3, $4, $5, $6)`,
        [
          factureId,
          ligne.produit_id,
          ligne.quantite,
          ligne.prix_unitaire,
          totalLigne,
          ligne.id,
        ]
      );
    }

    await client.query(
      'UPDATE devis SET statut = $1, facture_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
      ['converti', factureId, id]
    );

    return { facture_id: factureId, numero_facture: numeroFacture };
  }

  /**
   * Get paginated quotes with optional filters
   */
  async getAll(
    search?: string,
    statut?: string,
    client_id?: number,
    page: number = 1,
    limit: number = 20,
    sort: string = 'date_devis',
    order: string = 'DESC'
  ): Promise<any> {
    const validSortColumns = ['numero_devis', 'date_devis', 'total', 'statut', 'client_nom', 'date_validite'];
    const sortColumn = validSortColumns.includes(sort) ? sort : 'date_devis';
    const sortOrder = order.toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const offset = (page - 1) * limit;

    let query = `
      SELECT d.*, t.raison_sociale as client_nom, t.prenom as client_prenom, sl.nom as location_nom
      FROM devis d
      LEFT JOIN tiers t ON d.tiers_id = t.id
      LEFT JOIN stock_locations sl ON d.location_id = sl.id
      WHERE d.deleted_at IS NULL
    `;
    const params: any[] = [];

    if (search) {
      query += ' AND (d.numero_devis ILIKE $' + (params.length + 1) + ' OR t.raison_sociale ILIKE $' + (params.length + 2) + ')';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (statut) {
      query += ' AND d.statut = $' + (params.length + 1);
      params.push(statut);
    }

    if (client_id) {
      query += ' AND d.tiers_id = $' + (params.length + 1);
      params.push(client_id);
    }

    query += ` ORDER BY d.${sortColumn} ${sortOrder} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await pool.query(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) FROM devis d LEFT JOIN tiers t ON d.tiers_id = t.id WHERE d.deleted_at IS NULL`;
    const countParams: any[] = [];
    if (search) {
      countQuery += ' AND (d.numero_devis ILIKE $' + (countParams.length + 1) + ' OR t.raison_sociale ILIKE $' + (countParams.length + 2) + ')';
      countParams.push(`%${search}%`, `%${search}%`);
    }
    if (statut) {
      countQuery += ' AND d.statut = $' + (countParams.length + 1);
      countParams.push(statut);
    }
    if (client_id) {
      countQuery += ' AND d.tiers_id = $' + (countParams.length + 1);
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
   * Get quote by ID with lines
   */
  async getById(id: number): Promise<any> {
    const { rows: devisRows } = await pool.query(
      `SELECT d.*, t.raison_sociale as client_nom, t.prenom as client_prenom, t.email, t.telephone, t.adresse, t.nif,
              sl.nom as location_nom, sl.code as location_code,
              f.numero_facture as facture_numero
       FROM devis d
       LEFT JOIN tiers t ON d.tiers_id = t.id
       LEFT JOIN stock_locations sl ON d.location_id = sl.id
       LEFT JOIN factures f ON d.facture_id = f.id
       WHERE d.id = $1 AND d.deleted_at IS NULL`,
      [id]
    );

    if (devisRows.length === 0) return null;

    const { rows: lignesRows } = await pool.query(
      `SELECT dl.*,
              p.nom as produit_nom,
              p.reference as produit_reference,
              CASE
                WHEN dl.produit_id IS NULL THEN false
                WHEN EXISTS (
                  SELECT 1 FROM stock_par_location spl
                  JOIN stock_locations sl ON sl.id = spl.location_id
                  WHERE spl.produit_id = dl.produit_id
                    AND sl.actif = true
                    AND NOT (
                      UPPER(sl.code) LIKE 'DEPOT%'
                      OR UPPER(sl.nom) LIKE '%DÉPÔT%'
                      OR UPPER(sl.nom) LIKE '%DEPOT%'
                    )
                ) THEN false
                ELSE true
              END AS is_depot_only_history
       FROM document_lignes dl
       LEFT JOIN produits p ON dl.produit_id = p.id
       WHERE dl.document_type = 'devis' AND dl.document_id = $1
       ORDER BY dl.id`,
      [id]
    );

    return {
      ...devisRows[0],
      lignes: lignesRows,
    };
  }

  /**
   * Create a new quote
   */
  async create(input: CreateDevisInput): Promise<{ id: number; numero_devis: string; total: number }> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const tiers_id = input.tiers_id ?? input.client_id!;
      const { lignes, date_validite, notes, conditions, location_id, remise_globale, remise_globale_pct, cree_par, req } = input;
      const effectiveLocationId = await this.resolveMagasinLocationId(client, location_id);

      if (!lignes || lignes.length === 0) {
        throw new Error('Le devis doit contenir au moins un produit');
      }

      // Sales-rule: every product must have a magasin stock row.
      const offending: Array<{ index: number; produit_id: number; reason: string }> = [];
      for (let i = 0; i < lignes.length; i++) {
        const pid = lignes[i].produit_id;
        if (!pid) continue; // free-text line, not a product reference
        const { rows } = await client.query(
          `SELECT 1 FROM stock_par_location spl
           JOIN stock_locations sl ON sl.id = spl.location_id
           WHERE spl.produit_id = $1
             AND sl.actif = true
             AND NOT (
               UPPER(sl.code) LIKE 'DEPOT%'
               OR UPPER(sl.nom) LIKE '%DÉPÔT%'
               OR UPPER(sl.nom) LIKE '%DEPOT%'
             )
           LIMIT 1`,
          [pid]
        );
        if (rows.length === 0) {
          offending.push({ index: i, produit_id: Number(pid), reason: 'depot_only_stock' });
        }
      }
      if (offending.length > 0) {
        await client.query('ROLLBACK');
        const err: any = new Error('Article non disponible à la vente — stock dépôt.');
        err.statusCode = 422;
        err.code = 'SALES_DEPOT_LINE';
        err.offending_lines = offending;
        throw err;
      }

      // Generate quote number
      const numeroDevis = await generateDocumentNumber('devis', client);

      // Calculate totals
      const { sousTotal, remiseGlobale, remiseGlobalePct, total } = calculateTotals(
        lignes,
        remise_globale,
        remise_globale_pct
      );

      // Calculate validity date if not provided
      const dateValidite = date_validite || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // 30 days from now

      // Insert quote
      const { rows: devisResult } = await client.query(
        'INSERT INTO devis (numero_devis, tiers_id, date_devis, date_validite, sous_total, remise_globale, remise_globale_pct, tva, total, total_ht, total_ttc, notes, conditions, location_id, statut, cree_par) VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6, 0, $7, $7, $7, $8, $9, $10, $11, $12) RETURNING id',
        [numeroDevis, tiers_id, dateValidite, sousTotal, remiseGlobale, remiseGlobalePct, total, notes || null, conditions || null, effectiveLocationId, 'brouillon', cree_par || null]
      );

      const devisId = devisResult[0].id;

      // Batch insert quote lines
      const produitIds: (number | null)[] = [];
      const descriptions: (string | null)[] = [];
      const quantities: number[] = [];
      const prices: number[] = [];
      const remisePcts: number[] = [];
      const remiseMontants: number[] = [];
      const totals: number[] = [];

      for (const ligne of lignes) {
        produitIds.push(ligne.produit_id || null);
        descriptions.push(ligne.description || null);
        quantities.push(ligne.quantite);
        prices.push(ligne.prix_unitaire);
        remisePcts.push(ligne.remise_pct || 0);
        remiseMontants.push(ligne.remise_montant || 0);
        
        const totalLigne = ligne.quantite * ligne.prix_unitaire;
        totals.push(totalLigne);
      }

      await client.query(
        `INSERT INTO document_lignes (document_type, document_id, produit_id, description, quantite, prix_unitaire, remise_pct, remise_montant, total_ligne)
         SELECT 'devis', $1, unnest($2::int[]), unnest($3::text[]), unnest($4::int[]), unnest($5::numeric[]), unnest($6::numeric[]), unnest($7::numeric[]), unnest($8::numeric[])`,
        [devisId, produitIds, descriptions, quantities, prices, remisePcts, remiseMontants, totals]
      );

      await client.query('COMMIT');

      // Audit log
      if (cree_par) {
        await logAudit({
          utilisateur_id: cree_par,
          action: 'create',
          table_name: 'devis',
          record_id: devisId,
          req,
          new_values: { numero_devis: numeroDevis, tiers_id, total },
        });
      }

      logger.info({ devisId, numero_devis: numeroDevis }, 'Quote created successfully');
      return { id: devisId, numero_devis: numeroDevis, total };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Error creating quote');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update quote
   */
  async update(
    id: number,
    input: Partial<CreateDevisInput>,
    req?: any
  ): Promise<{ id: number }> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Check if quote exists and is still editable
      const { rows: existingRows } = await client.query(
        'SELECT id, statut FROM devis WHERE id = $1',
        [id]
      );

      if (existingRows.length === 0) {
        throw new Error('Devis non trouvé');
      }

      if (['accepte', 'converti', 'refuse'].includes(existingRows[0].statut)) {
        throw new Error('Cannot modify a quote that has been accepted, converted, or refused');
      }

      const upd_tiers_id = input.tiers_id ?? input.client_id;
      const { lignes, date_validite, notes, conditions, location_id, remise_globale, remise_globale_pct, cree_par } = input;

      const updates: string[] = [];
      const params: any[] = [];

      if (upd_tiers_id !== undefined) {
        params.push(upd_tiers_id);
        updates.push(`tiers_id = $${params.length}`);
      }
      if (date_validite !== undefined) {
        params.push(date_validite);
        updates.push(`date_validite = $${params.length}`);
      }
      if (notes !== undefined) {
        params.push(notes);
        updates.push(`notes = $${params.length}`);
      }
      if (conditions !== undefined) {
        params.push(conditions);
        updates.push(`conditions = $${params.length}`);
      }
      if (location_id !== undefined) {
        const effectiveLocationId = await this.resolveMagasinLocationId(client, location_id);
        params.push(effectiveLocationId);
        updates.push(`location_id = $${params.length}`);
      }
      if (remise_globale !== undefined) {
        params.push(remise_globale);
        updates.push(`remise_globale = $${params.length}`);
      }
      if (remise_globale_pct !== undefined) {
        params.push(remise_globale_pct);
        updates.push(`remise_globale_pct = $${params.length}`);
      }

      if (updates.length > 0) {
        params.push(id);
        await client.query(
          `UPDATE devis SET ${updates.join(', ')} WHERE id = $${params.length}`,
          params
        );
      }

      // Recalculate totals if lines provided
      if (lignes && lignes.length > 0) {
        // Delete old lines
        await client.query("DELETE FROM document_lignes WHERE document_type = 'devis' AND document_id = $1", [id]);

        // Recalculate
        const produitIds: (number | null)[] = [];
        const descriptions: (string | null)[] = [];
        const quantities: number[] = [];
        const prices: number[] = [];
        const remisePcts: number[] = [];
        const remiseMontants: number[] = [];

        for (const ligne of lignes) {
          produitIds.push(ligne.produit_id || null);
          descriptions.push(ligne.description || null);
          quantities.push(ligne.quantite);
          prices.push(ligne.prix_unitaire);
          remisePcts.push(ligne.remise_pct || 0);
          remiseMontants.push(ligne.remise_montant || 0);
        }

        const { sousTotal, remiseGlobale, remiseGlobalePct, total, totalLignes: totals } = calculateTotals(
          lignes,
          remise_globale,
          remise_globale_pct
        );

        // Update quote totals
        await client.query(
          'UPDATE devis SET sous_total = $1, remise_globale = $2, remise_globale_pct = $3, tva = 0, total = $4, total_ht = $4, total_ttc = $4 WHERE id = $5',
          [sousTotal, remiseGlobale, remiseGlobalePct, total, id]
        );

        // Insert new lines
        await client.query(
          `INSERT INTO document_lignes (document_type, document_id, produit_id, description, quantite, prix_unitaire, remise_pct, remise_montant, total_ligne)
           SELECT 'devis', $1, unnest($2::int[]), unnest($3::text[]), unnest($4::int[]), unnest($5::numeric[]), unnest($6::numeric[]), unnest($7::numeric[]), unnest($8::numeric[])`,
          [id, produitIds, descriptions, quantities, prices, remisePcts, remiseMontants, totals]
        );
      }

      await client.query('COMMIT');

      // Audit log
      if (cree_par) {
        await logAudit({
          utilisateur_id: cree_par,
          action: 'update',
          table_name: 'devis',
          record_id: id,
          req,
          new_values: input,
        });
      }

      logger.info({ devisId: id }, 'Quote updated successfully');
      return { id };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Error updating quote');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update quote status
   */
  async updateStatut(id: number, statut: string, req?: any): Promise<void> {
    const normalizedStatut = this.normalizeStatutInput(statut);
    const validStatuts = ['brouillon', 'envoye', 'accepte', 'refuse', 'annule'];
    if (!validStatuts.includes(normalizedStatut)) {
      throw new Error('Invalid statut');
    }

    const client = await pool.connect();
    let generatedBL: { bl_id: number; numero_bl: string } | null = null;

    try {
      await client.query('BEGIN');

      const { rows: devisRows } = await client.query(
        'SELECT id, statut, location_id FROM devis WHERE id = $1 FOR UPDATE',
        [id]
      );

      if (devisRows.length === 0) {
        throw new Error('Devis non trouvé');
      }

      const currentStatut = devisRows[0].statut;

      if (currentStatut === 'converti' && normalizedStatut !== 'converti') {
        throw new Error('Ce devis est déjà converti en facture');
      }

      if (normalizedStatut === 'annule') {
        const { rows: invoicedBLRows } = await client.query(
          `SELECT id
           FROM bons_livraison
           WHERE devis_id = $1
             AND statut = 'facture'
           LIMIT 1`,
          [id]
        );

        if (invoicedBLRows.length > 0) {
          throw new Error('Impossible d\'annuler ce devis: un bon de livraison est déjà facturé');
        }
      }

      await client.query(
        'UPDATE devis SET statut = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [normalizedStatut, id]
      );

      if (normalizedStatut === 'accepte') {
        generatedBL = await this.createBonLivraisonFromDevis(client, id, req?.user?.id);
      }

      if (normalizedStatut === 'annule') {
        await client.query(
          `UPDATE bons_livraison
           SET statut = 'annule', updated_at = CURRENT_TIMESTAMP
           WHERE devis_id = $1
             AND statut <> 'facture'`,
          [id]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    // Audit log
    if (req?.user?.id) {
      await logAudit({
        utilisateur_id: req.user.id,
        action: 'update_statut',
        table_name: 'devis',
        record_id: id,
        req,
        new_values: {
          statut: normalizedStatut,
          bon_livraison_genere: generatedBL ? generatedBL.numero_bl : null,
        },
      });
    }

    logger.info(
      {
        devisId: id,
        statut: normalizedStatut,
        blId: generatedBL?.bl_id,
      },
      'Quote statut updated'
    );
  }

  /**
   * Convert quote to invoice
   */
  async convertToFacture(id: number, userId: number, req?: any): Promise<{ facture_id: number; numero_facture: string }> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Ensure quote exists and is in a convertible state.
      const { rows: devisRows } = await client.query(
        'SELECT id, statut FROM devis WHERE id = $1 FOR UPDATE',
        [id]
      );

      if (devisRows.length === 0) {
        throw new Error('Devis non trouvé');
      }

      const currentStatut = devisRows[0].statut;
      if (currentStatut === 'converti') {
        throw new Error('Ce devis est déjà converti en facture');
      }
      if (['refuse', 'annule'].includes(currentStatut)) {
        throw new Error(`Impossible de convertir un devis au statut "${currentStatut}"`);
      }

      if (currentStatut !== 'accepte') {
        throw new Error('On ne peut pas facturer sans devis confirmé');
      }

      const effectiveLocationId = await this.resolveMagasinLocationId(client, devisRows[0].location_id);
      if (devisRows[0].location_id !== effectiveLocationId) {
        await client.query('UPDATE devis SET location_id = $1 WHERE id = $2', [effectiveLocationId, id]);
      }

      const { rows: deliveredBLRows } = await client.query(
        `SELECT id
         FROM bons_livraison
         WHERE devis_id = $1
           AND statut = 'livre'
         ORDER BY id DESC
         LIMIT 1`,
        [id]
      );

      if (deliveredBLRows.length === 0) {
        throw new Error('Le devis doit avoir au moins un bon de livraison marqué comme livré avant facturation');
      }

      let factureId: number;
      let numeroFacture: string;

      await client.query('SAVEPOINT devis_convert_sp');
      try {
        // Use DB-native function when available and healthy.
        const { rows } = await client.query(
          'SELECT convert_devis_to_facture($1, $2) as facture_id',
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

        // Legacy SQL function fails on FAC-YYYY-##### patterns; fallback to safe app conversion.
        await client.query('ROLLBACK TO SAVEPOINT devis_convert_sp');
        const fallbackResult = await this.convertToFactureFallback(client, id, userId);
        factureId = fallbackResult.facture_id;
        numeroFacture = fallbackResult.numero_facture;
      }

      await client.query('COMMIT');

      // Audit log
      if (userId) {
        await logAudit({
          utilisateur_id: userId,
          action: 'convert_to_facture',
          table_name: 'devis',
          record_id: id,
          req,
          new_values: { facture_id: factureId },
        });
      }

      logger.info({ devisId: id, factureId }, 'Quote converted to invoice');
      return { facture_id: factureId, numero_facture: numeroFacture };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Error converting quote to invoice');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Delete quote (soft delete)
   */
  async delete(id: number, req?: any): Promise<void> {
    await pool.query(
      'UPDATE devis SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );

    // Audit log
    if (req?.user?.id) {
      await logAudit({
        utilisateur_id: req.user.id,
        action: 'delete',
        table_name: 'devis',
        record_id: id,
        req,
      });
    }

    logger.info({ devisId: id }, 'Quote soft-deleted');
  }
}

export default new DevisService();
