import pool from '../db/connection';
import { logAudit } from '../middleware/audit';
import { logger } from '../utils/logger';
import { checkPeriodIsOpen } from './PeriodService';

export interface ReturnLigneInput {
  facture_id: number;
  produit_id: number;
  quantite: number;
  raison: string;
  notes?: string;
}

export interface CreateReturnInput {
  tiers_id: number;
  client_id?: number;
  lignes: ReturnLigneInput[];
  notes?: string;
  cree_par?: number;
  req?: any;
}

export class ReturnService {
  /**
   * Create customer return with stock restocking (transactional)
   */
  async create(input: CreateReturnInput): Promise<{ id: number; numero_retour: string; total: number }> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      await checkPeriodIsOpen(new Date(), client);

      const { lignes, notes, cree_par, req } = input;
      const client_id = input.tiers_id ?? input.client_id;

      if (!lignes || lignes.length === 0) {
        throw new Error('Le retour doit contenir au moins un produit');
      }

      // Verify invoice and quantities
      for (const ligne of lignes) {
        // Check invoice exists and belongs to client
        const { rows: factureRows } = await client.query(
          'SELECT id, statut FROM factures WHERE id = $1 AND tiers_id = $2 AND deleted_at IS NULL',
          [ligne.facture_id, client_id]
        );

        if (factureRows.length === 0) {
          await client.query('ROLLBACK');
          throw new Error(`Facture ${ligne.facture_id} non trouvée ou ne appartient pas à ce client`);
        }

        // Check quantity doesn't exceed what was invoiced
        const { rows: invoicedRows } = await client.query(
          "SELECT COALESCE(SUM(quantite), 0) as total_qte FROM document_lignes WHERE document_type = 'facture' AND document_id = $1 AND produit_id = $2",
          [ligne.facture_id, ligne.produit_id]
        );

        // Check previously returned quantity
        const { rows: returnedRows } = await client.query(
          `SELECT COALESCE(SUM(rl.quantite), 0) as total_retour
           FROM retour_lignes rl
           LEFT JOIN retours r ON rl.retour_id = r.id
           WHERE rl.produit_id = $1 AND r.tiers_id = $2 AND r.facture_id = $3 AND r.statut != 'annule'`,
          [ligne.produit_id, client_id, ligne.facture_id]
        );

        const maxReturnable = invoicedRows[0].total_qte - returnedRows[0].total_retour;
        if (ligne.quantite > maxReturnable) {
          await client.query('ROLLBACK');
          throw new Error(
            `Quantité excessive pour le produit ${ligne.produit_id} (facturé: ${invoicedRows[0].total_qte}, déjà retourné: ${returnedRows[0].total_retour}, disponible: ${maxReturnable})`
          );
        }
      }

      // Generate return number
      const { rows: countRows } = await client.query("SELECT COALESCE(MAX(CAST(SUBSTRING(numero_retour FROM '[0-9]+$') AS INTEGER)), 0) as max_num FROM retours");
      const numeroRetour = `RET-${new Date().getFullYear()}-${String(countRows[0].max_num + 1).padStart(5, '0')}`;

      // Calculate refund total
      let totalRemboursement = 0;
      for (const ligne of lignes) {
        const { rows: priceRows } = await client.query(
          "SELECT prix_unitaire FROM document_lignes WHERE document_type = 'facture' AND document_id = $1 AND produit_id = $2 LIMIT 1",
          [ligne.facture_id, ligne.produit_id]
        );

        if (priceRows.length > 0) {
          totalRemboursement += ligne.quantite * priceRows[0].prix_unitaire;
        }
      }

      // Insert return
      const { rows: returnResult } = await client.query(
        `INSERT INTO retours (numero_retour, tiers_id, total_remboursement, notes, cree_par, statut)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [numeroRetour, client_id, totalRemboursement, notes || null, cree_par || null, 'en_attente']
      );

      const returnId = returnResult[0].id;

      // Insert return lines and restock
      for (const ligne of lignes) {
        const { rows: priceRows } = await client.query(
          "SELECT prix_unitaire FROM document_lignes WHERE document_type = 'facture' AND document_id = $1 AND produit_id = $2 LIMIT 1",
          [ligne.facture_id, ligne.produit_id]
        );

        const prixUnitaire = priceRows.length > 0 ? priceRows[0].prix_unitaire : 0;

        await client.query(
          `INSERT INTO retour_lignes (retour_id, facture_id, produit_id, quantite, raison, prix_unitaire, total_ligne, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [returnId, ligne.facture_id, ligne.produit_id, ligne.quantite, ligne.raison, prixUnitaire, ligne.quantite * prixUnitaire, ligne.notes || null]
        );

        // Restock to the location where the original facture originated
        const { rows: factureLocRows } = await client.query(
          `SELECT COALESCE(location_id,
             (SELECT id FROM stock_locations WHERE est_principal = true AND actif = true LIMIT 1)
           ) as location_id FROM factures WHERE id = $1`,
          [ligne.facture_id]
        );
        const restockLocationId = factureLocRows[0]?.location_id || null;

        if (restockLocationId) {
          const { rows: stockBefore } = await client.query(
            `SELECT COALESCE(quantite, 0) as quantite FROM stock_par_location
             WHERE produit_id = $1 AND location_id = $2`,
            [ligne.produit_id, restockLocationId]
          );
          const stockAvant = stockBefore.length > 0 ? parseInt(stockBefore[0].quantite) : 0;

          await client.query(
            `INSERT INTO stock_par_location (produit_id, location_id, quantite)
             VALUES ($1, $2, $3)
             ON CONFLICT (produit_id, location_id)
             DO UPDATE SET quantite = stock_par_location.quantite + $3`,
            [ligne.produit_id, restockLocationId, ligne.quantite]
          );

          await client.query(
            `INSERT INTO mouvements_stock
               (produit_id, type_mouvement, quantite, stock_avant, stock_apres, raison, reference_liee, location_id)
             VALUES ($1, 'retour', $2, $3, $4, $5, $6, $7)`,
            [
              ligne.produit_id,
              ligne.quantite,
              stockAvant,
              stockAvant + ligne.quantite,
              `Retour client — ${numeroRetour}`,
              numeroRetour,
              restockLocationId,
            ]
          );
        } else {
          // Fallback to legacy produits.stock if no location resolved
          await client.query(
            'UPDATE produits SET stock = stock + $1 WHERE id = $2',
            [ligne.quantite, ligne.produit_id]
          );
        }
      }

      await client.query('COMMIT');

      // Audit log
      if (cree_par) {
        await logAudit({
          utilisateur_id: cree_par,
          action: 'create',
          table_name: 'retours',
          record_id: returnId,
          req,
          new_values: { numero_retour: numeroRetour, tiers_id: client_id, total: totalRemboursement },
        });
      }

      return { id: returnId, numero_retour: numeroRetour, total: totalRemboursement };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ err: error }, 'Error creating return');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get all returns
   */
  async getAll(page: number = 1, limit: number = 20): Promise<any> {
    const offset = (page - 1) * limit;

    const { rows } = await pool.query(
      `SELECT r.*, t.raison_sociale as client_nom,
        u.username as cree_par_username
       FROM retours r
       LEFT JOIN tiers t ON r.tiers_id = t.id
       LEFT JOIN utilisateurs u ON r.cree_par = u.id
       ORDER BY r.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const { rows: countRows } = await pool.query('SELECT COUNT(*) as total FROM retours');
    const total = parseInt(countRows[0].total);

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
   * Get return by ID
   */
  async getById(id: number): Promise<any | null> {
    const { rows: returnRows } = await pool.query(
      `SELECT r.*, t.raison_sociale as client_nom
       FROM retours r
       LEFT JOIN tiers t ON r.tiers_id = t.id
       WHERE r.id = $1`,
      [id]
    );

    if (returnRows.length === 0) return null;

    const { rows: lignesRows } = await pool.query(
      `SELECT rl.*, p.nom as produit_nom, p.reference as produit_reference,
        f.numero_facture
       FROM retour_lignes rl
       LEFT JOIN produits p ON rl.produit_id = p.id
       LEFT JOIN factures f ON rl.facture_id = f.id
       WHERE rl.retour_id = $1`,
      [id]
    );

    return {
      ...returnRows[0],
      lignes: lignesRows,
    };
  }

  /**
   * Update return status
   */
  async updateStatut(id: number, statut: string, userId?: number, req?: any): Promise<boolean> {
    const { rowCount } = await pool.query(
      'UPDATE retours SET statut = $1 WHERE id = $2',
      [statut, id]
    );

    if ((rowCount ?? 0) > 0 && userId) {
      await logAudit({
        utilisateur_id: userId,
        action: 'update',
        table_name: 'retours',
        record_id: id,
        req,
        new_values: { statut },
      });
    }

    return (rowCount ?? 0) > 0;
  }

  /**
   * Get return statistics
   */
  async getStats(): Promise<any> {
    const { rows } = await pool.query(
      `SELECT 
        COUNT(*) as total_retours,
        COUNT(*) FILTER (WHERE statut = 'en_attente') as en_attente,
        COUNT(*) FILTER (WHERE statut = 'traite') as traites,
        COUNT(*) FILTER (WHERE statut = 'annule') as annules,
        COALESCE(SUM(total_remboursement), 0) as montant_total_rembourse
       FROM retours`
    );
    return rows[0];
  }
}

export const returnService = new ReturnService();
