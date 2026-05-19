import pool from '../db/connection';
import { logAudit } from '../middleware/audit';
import { logger } from '../utils/logger';
import { calculateTotals } from './PricingService';
import { generateDocumentNumber } from './NumberingService';
import { ClientAllocationService } from './ClientAllocationService';
import { checkPeriodIsOpen } from './PeriodService';
import {
  resolveSalesLocationId,
} from './StockMagasinService';

export interface FactureLigneInput {
  produit_id: number;
  quantite: number;
  prix_unitaire: number;
}

export interface CreateFactureInput {
  tiers_id: number;
  client_id?: number; // legacy alias
  lignes: FactureLigneInput[];
  location_id?: number;
  notes?: string;
  cree_par?: number;
  req?: any; // Express request for audit
  remise_globale?: number;
  remise_globale_pct?: number;
}

export class FactureService {
  private isMagasinLocation(location: { code?: string | null; nom?: string | null }): boolean {
    const code = String(location.code || '').toUpperCase();
    const nom = String(location.nom || '').toUpperCase();

    if (code.startsWith('MAG') || nom.includes('MAGASIN')) return true;
    if (code.startsWith('DEPOT') || nom.includes('DEPOT') || nom.includes('DÉPÔT')) return false;

    return true;
  }

  private async resolveMagasinLocationId(client: any, requestedLocationId?: number): Promise<number> {
    return resolveSalesLocationId(requestedLocationId ?? null, client);
  }

  private async ensureRequiredAccountsForInvoice(client: any): Promise<void> {
    await client.query(
      `INSERT INTO plan_comptable (numero, intitule, type_compte, categorie)
       VALUES
        ('411', 'Clients', 'actif', 'classe4'),
        ('701', 'Ventes de marchandises', 'produit', 'classe7'),
        ('4457', 'TVA collectée', 'passif', 'classe4')
       ON CONFLICT (numero) DO NOTHING`
    );
  }

  private async getPrincipalLocationId(client: any): Promise<number> {
    const { rows } = await client.query(
      'SELECT id FROM stock_locations WHERE est_principal = true AND actif = true LIMIT 1'
    );

    if (rows.length === 0) {
      throw new Error('Aucune location principale active configuree');
    }

    return rows[0].id;
  }

  private calculateDueDate(delaiPaiement?: string): Date {
    const now = new Date();
    const normalized = (delaiPaiement || 'immediat').toLowerCase();

    const daysByTerm: Record<string, number> = {
      immediat: 0,
      net_30: 30,
      net_60: 60,
      net_90: 90,
    };

    const daysToAdd = daysByTerm[normalized] ?? 0;
    now.setDate(now.getDate() + daysToAdd);

    return now;
  }

  private formatDateForPg(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  /**
   * Get paginated invoices with optional filters
   */
  async getAll(
    search?: string,
    statut?: string,
    page: number = 1,
    limit: number = 20,
    sort: string = 'date_facture',
    order: string = 'DESC'
  ): Promise<any> {
    const validSortColumns = ['numero_facture', 'date_facture', 'total', 'statut', 'client_nom'];
    const sortColumn = validSortColumns.includes(sort) ? sort : 'date_facture';
    const sortOrder = order.toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const offset = (page - 1) * limit;

    let query = `
      SELECT f.*, t.raison_sociale as client_nom, t.prenom as client_prenom
      FROM factures f
      LEFT JOIN tiers t ON f.tiers_id = t.id
      WHERE f.deleted_at IS NULL
    `;
    const params: any[] = [];

    if (search) {
      const words = search.trim().split(/\s+/).filter(Boolean);
      for (const word of words) {
        const pattern = `%${word}%`;
        const n = params.length;
        query += ` AND (f.numero_facture ILIKE $${n + 1} OR t.raison_sociale ILIKE $${n + 2} OR COALESCE(t.prenom,'') ILIKE $${n + 3} OR COALESCE(t.telephone,'') ILIKE $${n + 4})`;
        params.push(pattern, pattern, pattern, pattern);
      }
    }

    if (statut) {
      query += ' AND f.statut = $' + (params.length + 1);
      params.push(statut);
    }

    query += ` ORDER BY f.${sortColumn} ${sortOrder} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await pool.query(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) FROM factures f LEFT JOIN tiers t ON f.tiers_id = t.id WHERE f.deleted_at IS NULL`;
    const countParams: any[] = [];
    if (search) {
      const words = search.trim().split(/\s+/).filter(Boolean);
      for (const word of words) {
        const pattern = `%${word}%`;
        const n = countParams.length;
        countQuery += ` AND (f.numero_facture ILIKE $${n + 1} OR t.raison_sociale ILIKE $${n + 2} OR COALESCE(t.prenom,'') ILIKE $${n + 3} OR COALESCE(t.telephone,'') ILIKE $${n + 4})`;
        countParams.push(pattern, pattern, pattern, pattern);
      }
    }
    if (statut) {
      countQuery += ' AND f.statut = $' + (countParams.length + 1);
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
   * Get invoice by ID with lines and payments
   */
  async getById(id: number): Promise<any> {
    const { rows: factureRows } = await pool.query(
      `SELECT f.*, t.raison_sociale as client_nom, t.prenom as client_prenom, t.email, t.telephone, t.adresse, t.nif
       FROM factures f
       LEFT JOIN tiers t ON f.tiers_id = t.id
       WHERE f.id = $1 AND f.deleted_at IS NULL`,
      [id]
    );

    if (factureRows.length === 0) return null;

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
       WHERE dl.document_type = 'facture' AND dl.document_id = $1`,
      [id]
    );

    const { rows: paiementsRows } = await pool.query(
      `SELECT id, montant, methode_paiement, date_paiement, reference
       FROM paiements
       WHERE facture_id = $1
       UNION ALL
       SELECT -id as id, montant, 'acompte' as methode_paiement, date_utilisation as date_paiement, 'Acompte #' || id as reference
       FROM acomptes_clients
       WHERE facture_id_applique = $1 AND statut = 'utilise'
       ORDER BY date_paiement DESC`,
      [id]
    );

    const { rows: originRows } = await pool.query(
      `SELECT d.id as devis_id, d.numero_devis, bl.id as bl_id, bl.numero_bl
       FROM factures f
       LEFT JOIN devis d ON f.devis_id = d.id
       LEFT JOIN bons_livraison bl ON f.bl_id = bl.id
       WHERE f.id = $1`,
      [id]
    );

    return {
      ...factureRows[0],
      lignes: lignesRows,
      paiements: paiementsRows,
      origine: originRows[0] || null,
    };
  }

  /**
   * Create invoice with automatic stock deduction (transactional)
   */
  async create(input: CreateFactureInput): Promise<{ id: number; numero_facture: string; total: number }> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Reject posts to closed accounting periods
      await checkPeriodIsOpen(new Date(), client);

      const tiers_id = input.tiers_id ?? input.client_id!;
      const { lignes, notes, cree_par, req, remise_globale, remise_globale_pct } = input;
      const client_id = tiers_id; // alias for SQL below
      const effectiveLocationId = await this.resolveMagasinLocationId(client, input.location_id);

      if (!lignes || lignes.length === 0) {
        throw new Error('La facture doit contenir au moins un produit');
      }

      // Verify stock availability
      for (const ligne of lignes) {
        const { rows: stockRows } = await client.query(
          `SELECT p.nom, COALESCE(spl.quantite, p.stock) as stock_location
           FROM produits p
           LEFT JOIN stock_par_location spl ON spl.produit_id = p.id AND spl.location_id = $2
           WHERE p.id = $1 AND p.deleted_at IS NULL`,
          [ligne.produit_id, effectiveLocationId]
        );

        if (stockRows.length === 0) {
          await client.query('ROLLBACK');
          throw new Error(`Produit ID ${ligne.produit_id} non trouvé`);
        }

        if (parseInt(stockRows[0].stock_location, 10) < ligne.quantite) {
          await client.query('ROLLBACK');
          throw new Error(
            `Stock insuffisant pour "${stockRows[0].nom}" dans cette location (disponible: ${stockRows[0].stock_location}, demande: ${ligne.quantite})`
          );
        }
      }

      // Generate invoice number
      const numeroFacture = await generateDocumentNumber('facture', client);

      // Get client financial policy for credit check and due date
      const { rows: clientRows } = await client.query(
        `SELECT
          raison_sociale as nom,
          prenom,
          COALESCE(credit_max, 0) as credit_max,
          COALESCE(solde_client_actuel, 0) as solde_actuel,
          COALESCE(delai_paiement, 'immediat') as delai_paiement
         FROM tiers
         WHERE id = $1 AND deleted_at IS NULL`,
        [tiers_id]
      );

      if (clientRows.length === 0) {
        await client.query('ROLLBACK');
        throw new Error(`Tiers ID ${tiers_id} non trouvé`);
      }

      // Calculate totals (no TVA)
      const { sousTotal, remiseGlobale, remiseGlobalePct, total } = calculateTotals(
        lignes,
        remise_globale,
        remise_globale_pct
      );

      // Enforce client credit limit when configured (> 0)
      const creditMax = parseFloat(clientRows[0].credit_max || 0);
      const soldeActuel = parseFloat(clientRows[0].solde_actuel || 0);
      const encoursApresFacture = soldeActuel + total;

      if (creditMax > 0 && encoursApresFacture > creditMax) {
        const clientNom = `${clientRows[0].nom || ''} ${clientRows[0].prenom || ''}`.trim();
        throw new Error(
          `Plafond de crédit dépassé pour ${clientNom}. Limite: ${creditMax.toFixed(2)}, Encours actuel: ${soldeActuel.toFixed(2)}, Après facture: ${encoursApresFacture.toFixed(2)}`
        );
      }

      const delaiPaiement = clientRows[0].delai_paiement || 'immediat';
      const dateEcheance = this.formatDateForPg(this.calculateDueDate(delaiPaiement));

      // Guard against legacy DB trigger variants that assume these accounts already exist.
      await this.ensureRequiredAccountsForInvoice(client);

      // Insert invoice
      let factureResult: any[] = [];
      try {
        await client.query('SAVEPOINT facture_insert');
        const insertWithDueDate = await client.query(
          'INSERT INTO factures (numero_facture, tiers_id, sous_total, tva, total, montant_paye, remaining_due, statut, notes, cree_par, remise_globale, remise_globale_pct, date_echeance, delai_paiement, location_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id',
          [numeroFacture, tiers_id, sousTotal, 0, total, 0, total, 'en_attente', notes || null, cree_par || null, remiseGlobale, remiseGlobalePct, dateEcheance, delaiPaiement, effectiveLocationId]
        );
        factureResult = insertWithDueDate.rows;
      } catch (error: any) {
        if (error?.code !== '42703') {
          throw error;
        }

        await client.query('ROLLBACK TO SAVEPOINT facture_insert');
        const insertLegacy = await client.query(
          'INSERT INTO factures (numero_facture, tiers_id, sous_total, tva, total, montant_paye, remaining_due, statut, notes, cree_par, remise_globale, remise_globale_pct) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id',
          [numeroFacture, tiers_id, sousTotal, 0, total, 0, total, 'en_attente', notes || null, cree_par || null, remiseGlobale, remiseGlobalePct]
        );
        factureResult = insertLegacy.rows;
      }

      const factureId = factureResult[0].id;

      // Batch insert lines and update stock
      const produitIds: number[] = [];
      const quantities: number[] = [];
      const prices: number[] = [];
      const totals: number[] = [];

      for (const ligne of lignes) {
        produitIds.push(ligne.produit_id);
        quantities.push(ligne.quantite);
        prices.push(ligne.prix_unitaire);
        totals.push(ligne.quantite * ligne.prix_unitaire);

        // Check stock availability before deduction
        const { rows: productRows } = await client.query(
          `SELECT COALESCE(quantite, 0) as quantite
           FROM stock_par_location
           WHERE produit_id = $1 AND location_id = $2
           FOR UPDATE`,
          [ligne.produit_id, effectiveLocationId]
        );

        let currentStock = productRows.length > 0 ? parseInt(productRows[0].quantite, 10) : 0;
        let useLegacyStock = false;

        if (productRows.length === 0) {
          const { rows: legacyRows } = await client.query(
            'SELECT stock FROM produits WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
            [ligne.produit_id]
          );
          if (legacyRows.length > 0) {
            currentStock = parseInt(legacyRows[0].stock, 10);
            useLegacyStock = true;
          }
        }

        if (currentStock < ligne.quantite) {
          throw new Error(`Stock insuffisant pour le produit ${ligne.produit_id}. Stock location disponible: ${currentStock}, quantite demandee: ${ligne.quantite}`);
        }

        if (useLegacyStock) {
          const { rowCount: legacyUpdated } = await client.query(
            'UPDATE produits SET stock = stock - $1 WHERE id = $2 AND stock >= $1 RETURNING stock',
            [ligne.quantite, ligne.produit_id]
          );
          if (!legacyUpdated || legacyUpdated === 0) {
            throw new Error(`Stock insuffisant (race) pour le produit ${ligne.produit_id}`);
          }
        } else {
          const { rowCount: splUpdated } = await client.query(
            `UPDATE stock_par_location
             SET quantite = quantite - $1
             WHERE produit_id = $2 AND location_id = $3 AND quantite >= $1
             RETURNING quantite`,
            [ligne.quantite, ligne.produit_id, effectiveLocationId]
          );
          if (!splUpdated || splUpdated === 0) {
            throw new Error(`Stock insuffisant (race) pour le produit ${ligne.produit_id} dans cette location`);
          }
        }

        // Record stock movement (will be committed with the facture)
        await client.query(
          `INSERT INTO mouvements_stock
             (produit_id, type_mouvement, quantite, stock_avant, stock_apres, raison, reference_liee, location_id)
           VALUES ($1, 'vente', $2, $3, $4, $5, $6, $7)`,
          [
            ligne.produit_id,
            -ligne.quantite,
            currentStock,
            currentStock - ligne.quantite,
            `Vente — facture ${numeroFacture}`,
            numeroFacture,
            effectiveLocationId,
          ]
        );
      }

      // Batch insert invoice lines without tax
      await client.query(
        `INSERT INTO document_lignes (document_type, document_id, produit_id, quantite, prix_unitaire, total_ligne)
         SELECT 'facture', $1, unnest($2::int[]), unnest($3::int[]), unnest($4::numeric[]), unnest($5::numeric[])`,
        [factureId, produitIds, quantities, prices, totals]
      );

      // Customer ledger: debit entry for new invoice
      await client.query(
        `INSERT INTO compte_client_lignes
           (tiers_id, type_operation, document_id, document_numero, montant_debit, montant_credit, notes, cree_par)
         VALUES ($1, 'facture', $2, $3, $4, 0, $5, $6)`,
        [tiers_id, factureId, numeroFacture, total, notes || null, cree_par || null]
      );

      // Recompute FIFO allocation (also refreshes clients.solde_actuel)
      await ClientAllocationService.recomputeClientAllocations(tiers_id, { transaction: client });

      // Audit log inside transaction so it's atomic with the business event
      await client.query(
        `INSERT INTO audit_log
           (utilisateur_id, action, table_name, record_id, ip_address, user_agent, new_values)
         VALUES ($1, 'create', 'factures', $2, $3, $4, $5)`,
        [
          cree_par || null,
          factureId,
          (req as any)?.ip || null,
          (req as any)?.get?.('user-agent') || null,
          JSON.stringify({ numero_facture: numeroFacture, tiers_id, total }),
        ]
      );

      await client.query('COMMIT');

      return { id: factureId, numero_facture: numeroFacture, total };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Error creating invoice');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update invoice status
   * Only 'annulee' and 'en_attente' may be set manually.
   * 'payee' and 'partielle' are computed exclusively by the payment trigger.
   */
  async updateStatut(id: number, statut: string, userId?: number, req?: any): Promise<boolean> {
    if (statut === 'payee' || statut === 'partielle') {
      throw new Error(`Le statut '${statut}' est calculé automatiquement par les paiements et ne peut pas être défini manuellement.`);
    }

    if (statut === 'annulee') {
      const { rows } = await pool.query(
        'SELECT COALESCE(SUM(montant), 0) as total_paye FROM paiements WHERE facture_id = $1',
        [id]
      );
      if (parseFloat(rows[0].total_paye) > 0) {
        throw new Error('Impossible d\'annuler une facture ayant des paiements enregistrés. Supprimez les paiements d\'abord.');
      }
    }

    const { rowCount } = await pool.query(
      'UPDATE factures SET statut = $1 WHERE id = $2 AND deleted_at IS NULL',
      [statut, id]
    );

    if ((rowCount ?? 0) > 0 && userId) {
      await logAudit({
        utilisateur_id: userId,
        action: 'update',
        table_name: 'factures',
        record_id: id,
        req,
        new_values: { statut },
      });
    }

    return (rowCount ?? 0) > 0;
  }

  /**
   * Soft delete invoice with optional stock restoration
   */
  async delete(id: number, restaurerStock: boolean = false, userId?: number, req?: any): Promise<boolean> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { rows: factureRows } = await client.query('SELECT statut, tiers_id FROM factures WHERE id = $1 AND deleted_at IS NULL', [id]);
      if (factureRows.length === 0) {
        await client.query('ROLLBACK');
        return false;
      }

      const clientId = factureRows[0].tiers_id;

      if (restaurerStock) {
        const { rows: locationRows } = await client.query(
          'SELECT COALESCE(location_id, (SELECT id FROM stock_locations WHERE est_principal = true AND actif = true LIMIT 1)) as effective_location_id FROM factures WHERE id = $1',
          [id]
        );
        const effectiveLocationId = locationRows[0]?.effective_location_id;

        const { rows: lignesRows } = await client.query(
          "SELECT produit_id, quantite FROM document_lignes WHERE document_type = 'facture' AND document_id = $1",
          [id]
        );

        for (const ligne of lignesRows) {
          const { rowCount: splUpdated } = await client.query(
            `UPDATE stock_par_location
             SET quantite = quantite + $1
             WHERE produit_id = $2 AND location_id = $3`,
            [ligne.quantite, ligne.produit_id, effectiveLocationId]
          );

          // Fall back to legacy produits.stock only when no stock_par_location row exists
          if (!splUpdated || splUpdated === 0) {
            await client.query(
              'UPDATE produits SET stock = stock + $1 WHERE id = $2',
              [ligne.quantite, ligne.produit_id]
            );
          }
        }
      }

      await client.query('UPDATE factures SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);

      // Recompute FIFO allocation for this client (deleted invoice releases its allocation)
      await ClientAllocationService.recomputeClientAllocations(clientId, { transaction: client });

      await client.query('COMMIT');

      if (userId) {
        await logAudit({
          utilisateur_id: userId,
          action: 'delete',
          table_name: 'factures',
          record_id: id,
          req,
        });
      }

      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get dashboard stats
   */
  async getStats(): Promise<any> {
    const { rows: totalFactures } = await pool.query(
      'SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as montant FROM factures WHERE statut != $1 AND deleted_at IS NULL',
      ['annulee']
    );
    const { rows: facturesMois } = await pool.query(
      'SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as montant FROM factures WHERE EXTRACT(MONTH FROM date_facture) = EXTRACT(MONTH FROM CURRENT_DATE) AND EXTRACT(YEAR FROM date_facture) = EXTRACT(YEAR FROM CURRENT_DATE) AND statut != $1 AND deleted_at IS NULL',
      ['annulee']
    );

    return {
      total_factures: totalFactures[0],
      factures_mois: facturesMois[0],
    };
  }

  /**
   * Get revenue trends
   */
  async getRevenueTrends(days: number = 30): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT
        DATE(date_facture)::date as date,
        COUNT(*) as count,
        COALESCE(SUM(total), 0) as total
       FROM factures
       WHERE statut != 'annulee' AND deleted_at IS NULL
         AND date_facture >= CURRENT_DATE - ($1 || ' days')::interval
       GROUP BY DATE(date_facture)
       ORDER BY date ASC`,
      [days]
    );
    return rows;
  }

  /**
   * Get top selling products
   */
  async getTopProducts(limit: number = 5): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT
        p.id,
        p.nom,
        p.reference,
        SUM(dl.quantite) as total_quantite,
        SUM(dl.total_ligne) as total_ventes
       FROM document_lignes dl
       LEFT JOIN produits p ON dl.produit_id = p.id
       WHERE dl.document_type = 'facture'
       GROUP BY p.id, p.nom, p.reference
       ORDER BY total_quantite DESC
       LIMIT $1`,
      [limit]
    );
    return rows;
  }

  /**
   * Get top clients by spending
   */
  async getTopClients(limit: number = 5): Promise<any[]> {
    const { rows } = await pool.query(
      `SELECT
        t.raison_sociale as nom,
        t.prenom,
        COUNT(f.id) as nombre_factures,
        COALESCE(SUM(f.total), 0) as total_depenses
       FROM factures f
       LEFT JOIN tiers t ON f.tiers_id = t.id
       WHERE f.statut != 'annulee' AND f.deleted_at IS NULL
       GROUP BY t.id, t.raison_sociale, t.prenom
       ORDER BY total_depenses DESC
       LIMIT $1`,
      [limit]
    );
    return rows;
  }
}

export const factureService = new FactureService();
